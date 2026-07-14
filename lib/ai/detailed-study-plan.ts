import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { getConfiguredAiModel, type AiModelConfig } from "@/lib/ai/provider";
import { sanitizeReadmeExcerpt } from "@/lib/readme";
import { getLearnerCommunicationGuidance, shouldIncludeLearnerGlossary } from "@/lib/learning-language";
import { getRepoSignal } from "@/lib/repository-signals";
import { classifyOperationalError } from "@/lib/operational-errors";
import {
  createDetailedStudyPlanGenerationContext,
  type DetailedStudyPlanGenerationContext
} from "@/lib/detailed-study-plan-cache";
import { defaultPreference } from "@/lib/seed-data";
import type {
  DetailedStudyDay,
  DetailedStudyPlan,
  DetailedStudyPlanDuration,
  DetailedStudyStep,
  RadarRecommendation
} from "@/lib/types";

const detailedStepSchema = z.object({
  title: z.string().min(2).max(80),
  purpose: z.string().min(4).max(240),
  actions: z.array(z.string().min(2).max(240)).min(2).max(5),
  references: z.array(z.string().min(1).max(160)).min(1).max(6),
  verification: z.string().min(4).max(240),
  deliverable: z.string().min(2).max(160),
  estimatedMinutes: z.number().int().min(10).max(240)
});

const detailedDaySchema = z.object({
  day: z.number().int().min(1).max(14),
  goal: z.string().min(2).max(100),
  outcome: z.string().min(4).max(240),
  steps: z.array(detailedStepSchema).min(2).max(4)
});

function createDetailedContentSchema(dayCount: number, startDay: number, endDay: number) {
  return z.object({
    summary: z.string().min(8).max(400),
    prerequisites: z.array(z.string().min(2).max(160)).min(2).max(8),
    glossary: z.array(z.object({
      term: z.string().min(1).max(60),
      explanation: z.string().min(4).max(180)
    })).max(6).default([]),
    days: z.array(detailedDaySchema).length(dayCount).superRefine((days, issueContext) => {
      const expected = Array.from({ length: dayCount }, (_, index) => startDay + index);
      if (days.some((day, index) => day.day !== expected[index] || day.day > endDay)) {
        issueContext.addIssue({ code: "custom", message: `days 必须连续覆盖 Day ${startDay}-${endDay}` });
      }
    })
  });
}

type DetailedContent = z.infer<ReturnType<typeof createDetailedContentSchema>>;

export async function generateDetailedStudyPlan(
  recommendation: RadarRecommendation,
  duration: DetailedStudyPlanDuration,
  context: DetailedStudyPlanGenerationContext = createDetailedStudyPlanGenerationContext(
    recommendation,
    duration,
    defaultPreference
  ),
  options: { allowRuleFallback?: boolean } = {}
): Promise<DetailedStudyPlan> {
  const fallback = createRuleBasedDetailedStudyPlan(recommendation, duration, context);
  const configuredModel = getConfiguredAiModel("detailed-study-plan");

  if (!configuredModel) {
    if (options.allowRuleFallback === false) {
      throw new Error("未配置 DeepSeek Pro，无法生成 AI 学习方案。");
    }
    return {
      ...fallback,
      fallbackReason: "not-configured",
      providerAttempts: []
    };
  }

  const controller = new AbortController();
  const timeoutMs = readBoundedInteger(process.env.STUDY_PLAN_AI_TIMEOUT_MS, 300_000, 30_000, 600_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const generated = await generateDeepSeekContent(
      configuredModel,
      recommendation,
      duration,
      context,
      1,
      duration,
      undefined,
      controller.signal
    );

    return createPlanRecord(recommendation, duration, generated.content, {
      source: "ai",
      provider: configuredModel.provider,
      modelId: configuredModel.modelId,
      cache: context.cache,
      providerAttempts: [
        {
          provider: "deepseek",
          modelId: configuredModel.modelId,
          status: "success",
          usage: generated.usage
        }
      ]
    });
  } catch (error) {
    const classified = classifyOperationalError(error, { system: "ai" });
    if (options.allowRuleFallback === false) {
      throw new Error(`DeepSeek Pro 生成完整 ${duration} 天方案失败：${classified.summary}`);
    }
    return {
      ...fallback,
      provider: configuredModel.provider,
      modelId: configuredModel.modelId,
      fallbackReason: "provider-error",
      errorSummary: classified.summary,
      errorCategory: classified.category,
      retryable: classified.retryable,
      providerAttempts: [
        {
          provider: "deepseek",
          modelId: configuredModel.modelId,
          status: "failed",
          errorSummary: classified.summary,
          errorCategory: classified.category,
          retryable: classified.retryable
        }
      ]
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function extendDetailedStudyPlan(
  recommendation: RadarRecommendation,
  existingPlan: DetailedStudyPlan,
  context: DetailedStudyPlanGenerationContext
): Promise<DetailedStudyPlan> {
  const generatedThroughDay = getGeneratedThroughDay(existingPlan);
  if (generatedThroughDay >= existingPlan.duration) return normalizePlanStageMetadata(existingPlan);

  const configuredModel = getConfiguredAiModel("detailed-study-plan");
  if (!configuredModel) {
    throw new Error("未配置 DeepSeek Pro，不能生成下一阶段；已有学习内容已保留。");
  }

  const startDay = generatedThroughDay + 1;
  const endDay = Math.min(existingPlan.duration, startDay + 2);
  const controller = new AbortController();
  const timeoutMs = readBoundedInteger(process.env.STUDY_PLAN_AI_TIMEOUT_MS, 300_000, 30_000, 600_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const generated = await generateDeepSeekContent(
      configuredModel,
      recommendation,
      existingPlan.duration,
      context,
      startDay,
      endDay,
      existingPlan,
      controller.signal
    );
    const newDays = addStableStepIds(generated.content.days);
    const providerAttempts = [
      ...(existingPlan.providerAttempts ?? []),
      {
        provider: "deepseek" as const,
        modelId: configuredModel.modelId,
        status: "success" as const,
        usage: generated.usage
      }
    ];

    return {
      ...existingPlan,
      source: existingPlan.source === "rule" ? "mixed" : existingPlan.source,
      provider: configuredModel.provider,
      modelId: configuredModel.modelId,
      providerAttempts,
      generatedAt: new Date().toISOString(),
      glossary: mergeGlossaries(existingPlan.glossary, generated.content.glossary),
      days: [...existingPlan.days, ...newDays].sort((a, b) => a.day - b.day),
      generatedThroughDay: endDay,
      generationStatus: endDay >= existingPlan.duration ? "complete" : "partial"
    };
  } catch (error) {
    const classified = classifyOperationalError(error, { system: "ai" });
    throw new Error(`DeepSeek Pro 生成 Day ${startDay}-${endDay} 失败：${classified.summary}。已有内容已保留。`);
  } finally {
    clearTimeout(timeout);
  }
}

async function generateDeepSeekContent(
  configuredModel: AiModelConfig,
  recommendation: RadarRecommendation,
  duration: DetailedStudyPlanDuration,
  context: DetailedStudyPlanGenerationContext,
  startDay: number,
  endDay: number,
  existingPlan: DetailedStudyPlan | undefined,
  abortSignal: AbortSignal
) {
  const dayCount = endDay - startDay + 1;
  const schema = createDetailedContentSchema(dayCount, startDay, endDay);
  let output: unknown;
  let normalizedUsage: ReturnType<typeof normalizeUsage>;
  try {
    const generated = await generateText({
      model: configuredModel.model,
      abortSignal,
      maxRetries: 1,
      output: Output.json(),
      temperature: 0.2,
      prompt: [
        ...buildPrompt(recommendation, duration, context, startDay, endDay, existingPlan),
        "API 已启用 JSON Output。只返回 JSON 对象，不要 Markdown、代码围栏或解释。",
        `glossary 最多 6 项；prerequisites 最多 8 项。days 必须恰好包含 ${dayCount} 项，连续覆盖 Day ${startDay}-${endDay}，每天恰好包含 2 个具体步骤。文字要精简，但操作、验证方法和交付物必须完整。`,
        "JSON 结构示例：",
        JSON.stringify({
          summary: "string",
          prerequisites: ["2-8 strings"],
          glossary: [{ term: "technical term", explanation: "plain Chinese explanation" }],
          days: [
            {
              day: 1,
              goal: "string",
              outcome: "string",
              steps: [
                {
                  title: "string",
                  purpose: "string",
                  actions: ["2-5 strings"],
                  references: ["1-6 real files, directories or commands from the input"],
                  verification: "string",
                  deliverable: "string",
                  estimatedMinutes: 60
                }
              ]
            }
          ]
        })
      ].join("\n")
    });
    output = generated.output;
    normalizedUsage = normalizeUsage(generated.usage);
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error) || !error.text?.trim()) throw error;
    try {
      output = parseDetailedStudyPlanModelJson(error.text);
      normalizedUsage = normalizeUsage(error.usage ?? {});
    } catch (parseError) {
      const finishReason = error.finishReason ?? "unknown";
      throw new Error(
        `DeepSeek 返回内容无法解析（finishReason=${finishReason}, chars=${error.text.length}）：${parseError instanceof Error ? parseError.message : "invalid JSON"}`,
        { cause: error }
      );
    }
  }
  const parsed = schema.safeParse(normalizeDetailedStudyPlanModelContent(output, startDay, endDay));

  if (!parsed.success) {
    throw new Error(`Detailed study plan validation failed: ${summarizeZodIssues(parsed.error.issues)}`);
  }

  return { content: parsed.data, usage: normalizedUsage };
}

export function parseDetailedStudyPlanModelJson(text: string) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    if (fenced) {
      try {
        return JSON.parse(fenced) as unknown;
      } catch {
        // Continue with balanced-object extraction below.
      }
    }
  }

  const extracted = extractBalancedJsonObject(trimmed);
  if (!extracted) throw new Error("没有找到完整 JSON 对象，响应可能被截断。");
  return JSON.parse(extracted) as unknown;
}

export function normalizeDetailedStudyPlanModelContent(value: unknown, startDay: number, endDay: number) {
  if (!isRecord(value)) return value;
  return {
    ...value,
    summary: clampModelString(value.summary, 400),
    prerequisites: clampModelStringArray(value.prerequisites, 8, 160),
    glossary: Array.isArray(value.glossary)
      ? value.glossary.slice(0, 6).map((item) => isRecord(item)
        ? {
            ...item,
            term: clampModelString(item.term, 60),
            explanation: clampModelString(item.explanation, 180)
          }
        : item)
      : value.glossary,
    days: Array.isArray(value.days)
      ? value.days
          .map(normalizeModelDay)
          .filter((day) => isRecord(day) && typeof day.day === "number" && day.day >= startDay && day.day <= endDay)
          .sort((left, right) => Number((left as Record<string, unknown>).day) - Number((right as Record<string, unknown>).day))
          .slice(0, endDay - startDay + 1)
      : value.days
  };
}

function normalizeModelDay(value: unknown) {
  if (!isRecord(value)) return value;
  return {
    ...value,
    day: coerceModelNumber(value.day),
    goal: clampModelString(value.goal, 100),
    outcome: clampModelString(value.outcome, 240),
    steps: Array.isArray(value.steps) ? value.steps.slice(0, 4).map(normalizeModelStep) : value.steps
  };
}

function normalizeModelStep(value: unknown) {
  if (!isRecord(value)) return value;
  const estimatedMinutes = coerceModelNumber(value.estimatedMinutes);
  return {
    ...value,
    title: clampModelString(value.title, 80),
    purpose: clampModelString(value.purpose, 240),
    actions: clampModelStringArray(value.actions, 5, 240),
    references: clampModelStringArray(value.references, 6, 160),
    verification: clampModelString(value.verification, 240),
    deliverable: clampModelString(value.deliverable, 160),
    estimatedMinutes: typeof estimatedMinutes === "number"
      ? Math.max(10, Math.min(240, Math.round(estimatedMinutes)))
      : estimatedMinutes
  };
}

function extractBalancedJsonObject(text: string) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function clampModelString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : value;
}

function clampModelStringArray(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value)
    ? value.slice(0, maxItems).map((item) => clampModelString(item, maxLength))
    : value;
}

function coerceModelNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildPrompt(
  recommendation: RadarRecommendation,
  duration: DetailedStudyPlanDuration,
  context: DetailedStudyPlanGenerationContext,
  startDay: number,
  endDay: number,
  existingPlan?: DetailedStudyPlan
) {
  const { repo, score, analysis } = recommendation;
  const compactRepo = {
    id: repo.id,
    fullName: repo.fullName,
    description: truncate(repo.description, 500),
    category: repo.category,
    primaryLanguage: repo.primaryLanguage,
    languages: repo.languages.slice(0, 8).map((language) => language.name),
    topics: repo.topics.slice(0, 12),
    readmeExcerpt: sanitizeReadmeExcerpt(repo.readmeExcerpt, 1200),
    detectedFiles: repo.detectedFiles.slice(0, 60),
    dependencies: repo.dependencies.slice(0, 20),
    hasTests: repo.hasTests,
    hasExamples: repo.hasExamples,
    hasCi: repo.hasCi,
    hasDocker: repo.hasDocker,
    enrichmentSignals: {
      tests: getRepoSignal(repo, "tests"),
      examples: getRepoSignal(repo, "examples"),
      ci: getRepoSignal(repo, "ci"),
      docker: getRepoSignal(repo, "docker"),
      readme: getRepoSignal(repo, "readme"),
      languages: getRepoSignal(repo, "languages"),
      rootFiles: getRepoSignal(repo, "rootFiles")
    }
  };

  return [
    "你是 GitHub 项目的实战学习教练。只能使用输入中的仓库证据，不允许浏览网页或虚构文件。",
    startDay === 1 && endDay === duration
      ? `一次性生成完整 ${duration} 天方案，连续覆盖 Day 1-${duration}，不要遗漏或留到后续生成。每一天恰好包含 2 个步骤。`
      : `目标是 ${duration} 天方案，本次只生成 Day ${startDay}-${endDay}，不要输出其他天。每一天恰好包含 2 个步骤。`,
    ...getLearnerCommunicationGuidance(context.preference.level),
    shouldIncludeLearnerGlossary(context.preference.level)
      ? "为本阶段实际使用的陌生技术名词提供 glossary；解释要像给第一次接触该概念的人说话。"
      : "glossary 可以为空，除非某个仓库专用名词不解释就容易误解。",
    "references 只能引用输入 detectedFiles 中真实出现的文件/目录，或写成“需要先确认：某类入口文件”，不能把猜测写成已存在事实。",
    "actions 要能直接照着执行，避免“阅读源码、实现模块、完善功能”这种没有范围和完成标准的泛化表达。",
    "计划应围绕 miniCloneScope，明确排除 excludedFeatures；命令只有在仓库证据支持时才能给出，否则要求先从清单文件确认脚本。",
    JSON.stringify({
      repo: compactRepo,
      score: {
        finalScore: score.finalScore,
        reasons: score.reasons.slice(0, 5),
        risks: score.risks.slice(0, 5)
      },
      analysis: {
        difficulty: analysis.difficulty,
        projectType: analysis.projectType,
        miniCloneScope: analysis.miniCloneScope,
        learningTags: analysis.learningTags.slice(0, 8)
      },
      learner: context.preference,
      previousStage: existingPlan
        ? {
            summary: existingPlan.summary,
            generatedThroughDay: getGeneratedThroughDay(existingPlan),
            days: existingPlan.days.map((day) => ({ day: day.day, goal: day.goal, outcome: day.outcome }))
          }
        : null,
      cacheVersion: {
        promptVersion: context.cache.promptVersion,
        schemaVersion: context.cache.schemaVersion
      }
    })
  ];
}

export function createRuleBasedDetailedStudyPlan(
  recommendation: RadarRecommendation,
  duration: DetailedStudyPlanDuration,
  context: DetailedStudyPlanGenerationContext = createDetailedStudyPlanGenerationContext(
    recommendation,
    duration,
    defaultPreference
  )
): DetailedStudyPlan {
  const content = createRuleBasedContent(recommendation, duration, context);
  return createPlanRecord(recommendation, duration, content, { source: "rule", cache: context.cache });
}

function createRuleBasedContent(
  recommendation: RadarRecommendation,
  duration: DetailedStudyPlanDuration,
  context: DetailedStudyPlanGenerationContext
): DetailedContent {
  const { repo, analysis } = recommendation;
  const evidence = getRepositoryEvidence(recommendation);
  const features = uniqueStrings(analysis.miniCloneScope.coreFeatures);
  const primaryFeature = features[0] ?? "核心输入到结果输出流程";
  const secondaryFeature = features[1] ?? "核心状态处理";
  const excluded = uniqueStrings(analysis.miniCloneScope.excludedFeatures).join("、") || "原项目的高级能力";
  const stages = buildStageCatalog({
    name: repo.name,
    fullName: repo.fullName,
    language: repo.primaryLanguage,
    primaryFeature,
    secondaryFeature,
    excluded,
    evidenceFiles: evidence.files,
    manifestReference: evidence.manifestReference,
    setupInstruction: evidence.setupInstruction,
    testInstruction: evidence.testInstruction
  });
  const allStageIndexes =
    duration === 3 ? [0, 6, 13] : duration === 7 ? [0, 1, 4, 5, 6, 10, 13] : stages.map((_, index) => index);
  const stageIndexes = allStageIndexes.slice(0, duration);
  const days = stageIndexes.map((stageIndex, dayIndex) => ({
    ...stages[stageIndex],
    day: dayIndex + 1,
    steps: stages[stageIndex].steps.map((step, stepIndex) => ({
      ...step,
      id: `day-${dayIndex + 1}-step-${stepIndex + 1}`
    }))
  }));

  return {
    summary: `面向${levelLabel(context.preference.level)}、以${goalLabel(context.preference.goal)}为目标，围绕 ${repo.fullName} 的 ${primaryFeature} 制作一个可运行、可验证的 mini 版本；所有文件引用均来自已保存的仓库信号或明确标注为需要先确认。`,
    prerequisites: uniqueStrings([
      `当前学习者水平：${levelLabel(context.preference.level)}；学习目标：${goalLabel(context.preference.goal)}`,
      `准备 ${repo.primaryLanguage} 开发环境`,
      evidence.setupInstruction,
      `明确不实现：${excluded}`,
      "为每天预留 60-120 分钟，并在完成后保存交付物"
    ]),
    glossary: shouldIncludeLearnerGlossary(context.preference.level)
      ? [
          { term: "mini 复刻", explanation: "只重做最能体现项目价值的一小段，不复制整个项目。" },
          { term: "主路径", explanation: "用户从输入开始，经过核心处理，最后看到结果的完整过程。" },
          { term: "交付物", explanation: "完成当天任务后必须留下的文件、截图、代码或记录。" }
        ]
      : [],
    days
  };
}

type RuleContext = {
  name: string;
  fullName: string;
  language: string;
  primaryFeature: string;
  secondaryFeature: string;
  excluded: string;
  evidenceFiles: string[];
  manifestReference: string;
  setupInstruction: string;
  testInstruction: string;
};

function buildStageCatalog(context: RuleContext): Array<Omit<DetailedStudyDay, "day">> {
  const refs = context.evidenceFiles;
  const manifest = [context.manifestReference];
  const miniRoot = `${context.name}-lite/`;

  return [
    stage("建立可运行基线和证据清单", "得到一份只包含真实文件、启动方式和 mini 边界的基线记录", [
      step("确认仓库入口和脚本", "避免根据语言猜测启动命令。", [
        `逐项检查 ${context.manifestReference}、README 与根目录信号，记录安装、开发、测试命令。`,
        context.setupInstruction,
        `把无法确认的入口标记为待确认，不把 ${context.fullName} 中未发现的文件写进方案。`
      ], uniqueStrings([...manifest, ...refs]), "基线记录中至少包含一个可验证命令或明确的阻塞原因。", "仓库运行与入口基线.md", 60),
      step("锁定 mini 复刻验收范围", `把 ${context.primaryFeature} 裁剪为个人可完成的闭环。`, [
        `用“输入 → ${context.primaryFeature} → 输出”写出一条主路径。`,
        `列出必须保留的 ${context.primaryFeature}、${context.secondaryFeature}，并明确排除 ${context.excluded}。`,
        "为主路径写出 3 条可观察的完成标准。"
      ], refs, "范围文档同时包含输入、输出、保留项、排除项和三条验收标准。", "mini 复刻范围说明.md", 45)
    ]),
    stage("画出真实数据流和模块边界", "能说明数据从入口到核心处理再到输出经过哪些模块", [
      step("追踪一条主路径", "用真实代码证据定位主流程，不做全仓库漫游。", [
        `从 ${context.manifestReference} 或 README 指向的入口开始，只追踪与 ${context.primaryFeature} 有关的调用。`,
        "记录输入结构、核心处理函数/组件和输出位置；找不到时记录搜索关键词与结果。",
        "画出最多 8 个节点的数据流图。"
      ], refs, "数据流图的每个代码节点都能对应一个已确认文件或待确认说明。", "主路径数据流图.md", 75),
      step("确定 mini 模块接口", "先固定边界，避免实现时不断扩大范围。", [
        `为 ${context.primaryFeature} 定义输入、输出和错误结构。`,
        `把 ${context.secondaryFeature} 作为独立模块或状态分支。`,
        "写两个正常样例和一个失败样例。"
      ], refs, "三个样例都能仅通过接口描述判断预期结果。", "模块接口草案.md", 45)
    ]),
    stage("提炼最小数据模型", "得到可以支撑主流程而不复制原项目全部结构的数据模型", [
      step("整理核心实体和状态", "让 mini 版本只保留主路径需要的数据。", [
        `从 README 和已确认文件中提取 ${context.primaryFeature} 需要的字段。`,
        "区分必填、可选、默认值和错误状态。",
        `使用 ${context.language} 写出类型、接口或数据类草案。`
      ], refs, "数据模型能表达两个正常样例和一个失败样例。", "核心数据模型草案", 60),
      step("编写模型级样例", "在进入 UI 或接口之前验证数据设计。", [
        "准备最小、典型、非法三组样例数据。",
        "为每组数据写出预期状态变化和输出。"
      ], refs, "三组样例都有确定输入与预期输出。", "模型样例数据", 40)
    ]),
    stage("固定输入输出契约", "主流程的输入校验、成功输出和失败输出都有明确格式", [
      step("定义输入校验", "把边界错误提前变成可测试规则。", [
        "列出空值、格式错误、缺少配置三类输入。",
        "为每类输入指定错误码或用户可读提示。"
      ], refs, "每类非法输入都有唯一且可断言的结果。", "输入校验清单", 45),
      step("定义结果协议", "让展示层和核心逻辑不依赖隐式状态。", [
        "定义成功结果、处理中状态和失败结果。",
        `确认结果字段足够展示 ${context.primaryFeature} 的核心价值。`
      ], refs, "结果协议能覆盖正常、处理中、失败三种状态。", "结果协议草案", 45)
    ]),
    stage("搭建可运行的 mini 骨架", "mini 项目能够启动，并有明确的核心模块位置", [
      step("创建最小目录与脚本", "先建立可运行骨架，再迁移业务逻辑。", [
        `在 ${miniRoot} 中使用 ${context.language} 创建最小项目。`,
        "只添加主入口、核心模块、测试目录和 README，不复制原仓库无关模块。",
        "在 README 记录实际安装、启动和测试命令。"
      ], uniqueStrings([context.manifestReference, miniRoot]), "从空环境按 README 命令能够启动骨架，或能得到已记录的单一阻塞原因。", "可启动的 mini 项目骨架", 90),
      step("加入健康检查或最小页面", "用最小可见结果确认工具链已经接通。", [
        "返回或展示项目名称、版本和 ready 状态。",
        "主动制造一次启动错误，确认错误能被看见。"
      ], [miniRoot], "正常启动能看到 ready；错误配置能看到明确提示。", "启动基线截图或日志", 45)
    ]),
    stage(`实现第一段核心能力：${context.primaryFeature}`, "主流程能够接收真实形状的输入并产出中间结果", [
      step("实现纯核心函数", "先把业务规则与页面、网络或存储分离。", [
        `为 ${context.primaryFeature} 创建一个只接收明确输入并返回明确结果的核心函数。`,
        "使用前面准备的最小和典型样例手动调用。",
        "记录与原仓库行为不同的裁剪点。"
      ], uniqueStrings([...refs, `${miniRoot}核心模块`]), "两个正常样例均得到预期中间结果，且不依赖界面操作。", `${context.primaryFeature} 核心函数`, 90),
      step("补核心函数断言", "立即锁定最重要的行为，防止后续接线破坏。", [
        "为正常输入和非法输入各写至少一个断言。",
        context.testInstruction
      ], [miniRoot], "至少两个断言可重复执行并通过。", "核心行为测试", 45)
    ]),
    stage("接通输入、核心处理和结果展示", "用户可以完整走通一次 mini 主路径", [
      step("连接主路径", "把已经验证的核心函数接到最小输入与输出层。", [
        `实现“输入 → ${context.primaryFeature} → 结果”这一条路径。`,
        `把 ${context.secondaryFeature} 放在明确的状态分支中。`,
        "暂不加入登录、权限、计费或原项目高级能力。"
      ], uniqueStrings([...refs, miniRoot]), "使用典型样例可以从入口完成一次操作并看到结果。", "可运行的主流程 demo", 120),
      step("记录可复现演示步骤", "让别人不需要阅读源码也能验证成果。", [
        "写出启动命令、输入样例、预期输出。",
        "保存一次成功流程的截图或终端输出。"
      ], [miniRoot], "按文档从启动到得到结果不超过 5 个操作。", "主流程演示说明", 35)
    ]),
    stage("加入必要的状态与数据持久化", "刷新或重新执行后，主流程的重要状态行为符合预期", [
      step("定义需要保存的最小状态", "只保存 mini 主路径需要的数据。", [
        "列出必须跨刷新保留和无需保留的字段。",
        "选择内存、本地文件或浏览器存储中的最小方案，并写明原因。"
      ], [miniRoot], "状态清单没有包含排除范围中的功能。", "状态持久化决策.md", 45),
      step("实现保存和恢复", "验证数据生命周期，而不是只验证单次演示。", [
        "在一次成功操作后保存最小状态。",
        "重新启动或刷新后恢复状态，并提供清空方法。"
      ], [miniRoot], "保存、恢复、清空三条路径都有可观察结果。", "状态保存与恢复功能", 90)
    ]),
    stage("补齐错误、空状态和边界", "常见失败不会白屏或静默失败", [
      step("实现三类失败状态", "让错误行为和成功行为一样可验证。", [
        "实现空输入、非法输入、核心处理异常三种状态。",
        "每种状态给出下一步操作，而不只显示“失败”。"
      ], [miniRoot], "三种失败均能稳定复现且提示不同。", "错误状态清单与截图", 75),
      step("验证边界不会污染状态", "避免失败后残留上一次结果。", [
        "先执行成功样例，再执行失败样例。",
        "确认 loading、结果和错误状态不会互相残留。"
      ], [miniRoot], "成功→失败→重试的连续流程结果正确。", "连续状态验证记录", 45)
    ]),
    stage("加入可观察性和调试信息", "主路径出错时能快速定位到输入、阶段和原因", [
      step("设计最小调试输出", "保留学习所需信息，同时避免无结构日志。", [
        "为开始、核心处理完成、失败三个节点记录结构化信息。",
        "确认日志不包含密钥、Token 或完整敏感输入。"
      ], [miniRoot], "一次成功和一次失败都能从日志定位执行阶段。", "调试日志样例", 50),
      step("加入耗时或状态提示", "让慢操作不会被误认为卡死。", [
        "展示 processing 状态或记录核心步骤耗时。",
        "确认完成和失败后 processing 都会结束。"
      ], [miniRoot], "慢操作期间有反馈，结束后状态复位。", "运行状态反馈", 45)
    ]),
    stage("建立可重复测试", "主路径、错误路径和状态恢复可以通过一条命令复查", [
      step("补主路径与错误测试", "把手工验证转成可重复证据。", [
        "至少覆盖一个成功样例、一个非法输入和一个核心异常。",
        context.testInstruction,
        "将实际测试命令写入 README。"
      ], uniqueStrings([context.manifestReference, ...refs, miniRoot]), "测试命令连续执行两次均得到相同结果。", "自动化测试与运行记录", 90),
      step("建立验收清单", "保证测试通过不等于交付完成。", [
        "按输入、处理、输出、错误、恢复五类整理验收项。",
        "逐项记录通过、失败或不适用。"
      ], [miniRoot], "每个验收项都有状态和证据链接。", "mini 版本验收清单", 40)
    ]),
    stage("优化交互与使用说明", "第一次接触项目的人能在 10 分钟内跑通主流程", [
      step("减少首次使用阻力", "把隐含知识写进界面或文档。", [
        "为输入提供示例、默认值或占位说明。",
        "为错误提示补充可执行的修正建议。"
      ], [miniRoot], "新用户无需读源码即可构造一次有效输入。", "首次使用优化", 60),
      step("执行陌生用户走查", "从使用者视角发现遗漏步骤。", [
        "清空本地状态并严格按 README 操作。",
        "记录所有需要猜测的步骤并补充说明。"
      ], uniqueStrings([context.manifestReference, miniRoot]), "README 中不再存在必须靠猜测才能继续的关键步骤。", "走查问题与修订记录", 45)
    ]),
    stage("准备部署或可移交运行包", "成果能够在另一环境启动并复现", [
      step("固定运行环境", "减少只在当前电脑可运行的问题。", [
        "记录运行时版本、依赖安装命令和必要配置。",
        "提供示例环境变量文件，但不写入真实密钥。"
      ], uniqueStrings([context.manifestReference, miniRoot]), "全新目录按文档能安装并启动，或阻塞项被明确记录。", "环境与启动说明", 60),
      step("整理展示材料", "让 mini 复刻的学习价值清晰可见。", [
        `说明原项目 ${context.fullName}、复刻范围和主动舍弃的 ${context.excluded}。`,
        "准备一张主流程截图和一张错误状态截图。"
      ], [miniRoot], "展示材料能够说明问题、方案、主流程和验证结果。", "项目展示素材", 60)
    ]),
    stage("完成最终验收与复盘", "得到可演示版本、完整验证证据和下一步改进清单", [
      step("执行端到端验收", "用固定样例证明 mini 主路径已经闭环。", [
        "从空状态启动项目并执行一个成功样例。",
        "执行一个失败样例并完成修正或重试。",
        "运行测试命令并保存输出。"
      ], uniqueStrings([context.manifestReference, ...refs, miniRoot]), "启动、成功、失败、重试、测试五项均有可查看证据。", "最终验收记录", 90),
      step("写复盘并确定下一步", "把复刻结果转化为可复用经验。", [
        `对比 ${context.fullName} 与 mini 版本，记录保留、简化、舍弃内容。`,
        "列出三条学到的工程方法和两个仍未确认的问题。",
        "只选择一个下一阶段功能，避免重新扩大范围。"
      ], [miniRoot], "复盘包含证据、差异、问题和唯一下一步。", "可展示的 mini 项目与复盘.md", 60)
    ])
  ];
}

function stage(
  goal: string,
  outcome: string,
  steps: Array<Omit<DetailedStudyStep, "id">>
): Omit<DetailedStudyDay, "day"> {
  return { goal, outcome, steps: steps as DetailedStudyStep[] };
}

function step(
  title: string,
  purpose: string,
  actions: string[],
  references: string[],
  verification: string,
  deliverable: string,
  estimatedMinutes: number
): Omit<DetailedStudyStep, "id"> {
  return {
    title,
    purpose,
    actions: uniqueStrings(actions),
    references: uniqueStrings(references),
    verification,
    deliverable,
    estimatedMinutes
  };
}

function getRepositoryEvidence(recommendation: RadarRecommendation) {
  const { repo } = recommendation;
  const files = uniqueStrings(repo.detectedFiles).slice(0, 8);
  const lowerFiles = files.map((file) => file.toLowerCase());
  const manifestCandidates = [
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "cargo.toml",
    "go.mod",
    "composer.json",
    "gemfile"
  ];
  const knownManifest = files.find((file) => manifestCandidates.includes(file.toLowerCase()));
  const manifestReference = knownManifest ?? inferManifestReference(repo.primaryLanguage);
  const packageManager = lowerFiles.includes("pnpm-lock.yaml")
    ? "pnpm"
    : lowerFiles.includes("yarn.lock")
      ? "yarn"
      : lowerFiles.includes("package-lock.json")
        ? "npm"
        : null;
  const setupInstruction = packageManager
    ? `确认 ${manifestReference} 中的 scripts 后执行 ${packageManager} install；不要直接猜测 dev/build 命令。`
    : `先从 ${manifestReference} 和 README 确认安装与启动命令，再执行；当前缓存没有足够证据指定包管理器。`;
  const testSignal = getRepoSignal(repo, "tests");
  const testInstruction =
    testSignal === "present"
      ? `从 ${manifestReference} 确认真实测试脚本并执行，不要猜测测试命令。`
      : testSignal === "absent"
        ? "已检查根目录但未发现测试入口；为 mini 版本建立最小测试脚本并记录命令。"
        : "测试入口抓取状态未知；先检查根目录和清单文件，再决定复用原测试或为 mini 版本建立测试。";

  return {
    files: files.length > 0 ? files : ["README.md", "需要先确认：根目录清单与真实入口文件"],
    manifestReference,
    setupInstruction,
    testInstruction
  };
}

function inferManifestReference(language: string) {
  const normalized = language.toLowerCase();
  if (["typescript", "javascript", "vue", "svelte"].includes(normalized)) return "需要先确认：package.json";
  if (normalized === "python") return "需要先确认：pyproject.toml 或 requirements.txt";
  if (normalized === "rust") return "需要先确认：Cargo.toml";
  if (normalized === "go") return "需要先确认：go.mod";
  return "需要先确认：仓库清单文件";
}

function createPlanRecord(
  recommendation: RadarRecommendation,
  duration: DetailedStudyPlanDuration,
  content: DetailedContent,
  metadata: Pick<DetailedStudyPlan, "source" | "provider" | "modelId" | "providerAttempts" | "cache">
): DetailedStudyPlan {
  const generatedAt = new Date().toISOString();
  const days = addStableStepIds(content.days);
  const generatedThroughDay = days.at(-1)?.day ?? 0;

  return {
    id: `${recommendation.repo.id}-${duration}-${Date.now()}`,
    repoId: recommendation.repo.id,
    repoFullName: recommendation.repo.fullName,
    duration,
    source: metadata.source,
    provider: metadata.provider,
    modelId: metadata.modelId,
    providerAttempts: metadata.providerAttempts ?? [],
    cache: metadata.cache,
    basedOnPushedAt: recommendation.repo.pushedAt,
    generatedAt,
    summary: content.summary,
    prerequisites: uniqueStrings(content.prerequisites),
    glossary: content.glossary,
    days,
    generatedThroughDay,
    generationStatus: generatedThroughDay >= duration ? "complete" : "partial"
  };
}

function addStableStepIds(days: DetailedContent["days"]): DetailedStudyDay[] {
  return days.map((day) => ({
    ...day,
    steps: day.steps.map((step, stepIndex) => ({
      ...step,
      id: `day-${day.day}-step-${stepIndex + 1}`
    }))
  }));
}

function getGeneratedThroughDay(plan: DetailedStudyPlan) {
  return plan.generatedThroughDay ?? Math.max(0, ...plan.days.map((day) => day.day));
}

function normalizePlanStageMetadata(plan: DetailedStudyPlan): DetailedStudyPlan {
  const generatedThroughDay = getGeneratedThroughDay(plan);
  return {
    ...plan,
    generatedThroughDay,
    generationStatus: generatedThroughDay >= plan.duration ? "complete" : "partial"
  };
}

function mergeGlossaries(
  left: DetailedStudyPlan["glossary"],
  right: DetailedStudyPlan["glossary"]
) {
  const merged = new Map<string, { term: string; explanation: string }>();
  for (const item of [...(left ?? []), ...(right ?? [])]) merged.set(item.term.trim().toLowerCase(), item);
  return [...merged.values()].slice(0, 10);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function summarizeZodIssues(issues: z.ZodIssue[]) {
  return truncate(
    issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; "),
    220
  );
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function readBoundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) {
  const inputTokens = Math.max(0, Math.round(usage.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.round(usage.outputTokens ?? 0));
  return {
    inputTokens,
    outputTokens,
    totalTokens: Math.max(inputTokens + outputTokens, Math.round(usage.totalTokens ?? 0))
  };
}

function levelLabel(level: DetailedStudyPlanGenerationContext["preference"]["level"]) {
  if (level === "beginner") return "入门水平";
  if (level === "advanced") return "进阶水平";
  return "中级水平";
}

function goalLabel(goal: DetailedStudyPlanGenerationContext["preference"]["goal"]) {
  if (goal === "portfolio") return "作品集交付";
  if (goal === "trend") return "趋势探索";
  if (goal === "source-reading") return "源码阅读";
  return "Mini 复刻";
}
