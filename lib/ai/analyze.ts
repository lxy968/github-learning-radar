import { generateText, Output } from "ai";
import { z } from "zod";
import { getConfiguredAiModel, type AiModelConfig } from "@/lib/ai/provider";
import { classifyOperationalError } from "@/lib/operational-errors";
import { getRepoSignal } from "@/lib/repository-signals";
import { sanitizeReadmeExcerpt } from "@/lib/readme";
import { getLearnerCommunicationGuidance } from "@/lib/learning-language";
import { defaultPreference, seedAnalyses } from "@/lib/seed-data";
import type {
  AiProviderAttempt,
  RadarRecommendation,
  RepoAnalysis,
  RepoSnapshot,
  RuleScore,
  UserPreference
} from "@/lib/types";

export const repositoryAnalysisPromptVersion = "radar-analysis-prompt-v3";
export const repositoryAnalysisSchemaVersion = "radar-analysis-schema-v2";

const planDaySchema = z.object({
  day: z.number(),
  goal: z.string(),
  tasks: z.array(z.string()).min(2).max(5),
  deliverable: z.string()
});

const repoAnalysisFields = {
  projectType: z.string().min(2).max(60),
  oneLineSummary: z.string().min(12).max(180),
  learningTags: z.array(z.string().min(1).max(40)).min(2).max(8),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
  whyLearn: z.array(z.string().min(6).max(120)).min(2).max(5),
  miniCloneScope: z.object({
    goal: z.string().min(12).max(220),
    coreFeatures: z.array(z.string().min(2).max(60)).min(2).max(6),
    excludedFeatures: z.array(z.string().min(2).max(80)).min(1).max(6)
  }),
  recommendedFor: z.array(z.string()).min(1).max(5),
  notRecommendedFor: z.array(z.string()).min(1).max(5),
  risks: z.array(z.string()).min(1).max(6),
  confidence: z.number().min(0).max(1)
};

const aiRepoAnalysisSchema = z.object({
  ...repoAnalysisFields,
  learningPlan: z.object({
    plan3Days: z.array(planDaySchema).length(3)
  })
});

export const repoAnalysisSchema = z.object({
  ...repoAnalysisFields,
  learningPlan: z.object({
    plan3Days: z.array(planDaySchema).length(3),
    plan7Days: z.array(planDaySchema).length(7),
    plan14Days: z.array(planDaySchema).length(14)
  })
});

export type RepositoryAnalysisResult = {
  analysis: RepoAnalysis;
  source: "ai" | "seed" | "rule";
  provider?: string;
  modelId?: string;
  fallbackReason?: "not-configured" | "provider-error";
  errorSummary?: string;
  errorCategory?: string;
  retryable?: boolean;
  usage?: AiTokenUsage;
  providerAttempts: AiProviderAttempt[];
};

export type AiTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export async function analyzeRepository(
  repo: RepoSnapshot,
  score: RuleScore,
  preference: UserPreference
): Promise<RepoAnalysis> {
  return (await analyzeRepositoryWithFallback(repo, score, preference)).analysis;
}

export async function analyzeRepositoryWithFallback(
  repo: RepoSnapshot,
  score: RuleScore,
  preference: UserPreference
): Promise<RepositoryAnalysisResult> {
  const fallback = getFallbackAnalysis(repo, score, preference);
  const configuredModel = getConfiguredAiModel("radar-analysis");

  if (!configuredModel) {
    return {
      analysis: fallback.analysis,
      source: fallback.source,
      fallbackReason: "not-configured",
      providerAttempts: []
    };
  }

  const controller = new AbortController();
  const timeoutMs = readBoundedInteger(process.env.RADAR_AI_TIMEOUT_MS, 25_000, 5_000, 120_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const generated = await generateDeepSeekJsonAnalysis(
      configuredModel.model,
      repo,
      score,
      preference,
      controller.signal
    );
    const attempt: AiProviderAttempt = {
      provider: "deepseek",
      modelId: configuredModel.modelId,
      status: "success",
      usage: generated.usage
    };

    return {
      analysis: expandAiAnalysis(repo, generated.object),
      source: "ai",
      provider: configuredModel.provider,
      modelId: configuredModel.modelId,
      usage: generated.usage,
      providerAttempts: [attempt]
    };
  } catch (error) {
    const classified = classifyOperationalError(error, { system: "ai" });
    return {
      analysis: fallback.analysis,
      source: fallback.source,
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

async function generateDeepSeekJsonAnalysis(
  model: AiModelConfig["model"],
  repo: RepoSnapshot,
  score: RuleScore,
  preference: UserPreference,
  abortSignal: AbortSignal
) {
  const { output, usage } = await generateText({
    model,
    abortSignal,
    maxRetries: 2,
    maxOutputTokens: 1800,
    output: Output.json(),
    temperature: 0.2,
    prompt: [
      ...buildAnalysisPrompt(repo, score, preference),
      "API 已启用 JSON Output。你必须只返回一个 JSON 对象。",
      "不要输出 Markdown，不要输出代码围栏，不要输出解释文字。",
      "JSON 字段必须完全符合这个结构：",
      JSON.stringify({
        projectType: "string",
        oneLineSummary: "string",
        learningTags: ["2-8 strings"],
        difficulty: "beginner | intermediate | advanced",
        whyLearn: ["2-5 strings"],
        miniCloneScope: {
          goal: "string",
          coreFeatures: ["2-6 strings"],
          excludedFeatures: ["1-6 strings"]
        },
        recommendedFor: ["1-5 strings"],
        notRecommendedFor: ["1-5 strings"],
        risks: ["1-6 strings"],
        confidence: "number between 0 and 1",
        learningPlan: {
          plan3Days: [{ day: 1, goal: "string", tasks: ["2-5 strings"], deliverable: "string" }]
        }
      })
    ].join("\n")
  });
  const parsed = aiRepoAnalysisSchema.safeParse(output);

  if (!parsed.success) {
    throw new Error(`AI JSON validation failed: ${summarizeZodIssues(parsed.error.issues)}`);
  }

  return { object: parsed.data, usage: normalizeUsage(usage) };
}

function normalizeUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }): AiTokenUsage {
  const inputTokens = Math.max(0, Math.round(usage.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.round(usage.outputTokens ?? 0));
  return {
    inputTokens,
    outputTokens,
    totalTokens: Math.max(inputTokens + outputTokens, Math.round(usage.totalTokens ?? 0))
  };
}

function buildAnalysisPrompt(repo: RepoSnapshot, score: RuleScore, preference: UserPreference) {
  const compactRepo = {
    ...repo,
    description: truncate(repo.description, 500),
    topics: repo.topics.slice(0, 12),
    languages: repo.languages.slice(0, 8),
    readmeExcerpt: sanitizeReadmeExcerpt(repo.readmeExcerpt, 1400),
    detectedFiles: repo.detectedFiles.slice(0, 40),
    dependencies: repo.dependencies.slice(0, 16),
    enrichment: {
      readme: getRepoSignal(repo, "readme"),
      languages: getRepoSignal(repo, "languages"),
      rootFiles: getRepoSignal(repo, "rootFiles"),
      tests: getRepoSignal(repo, "tests"),
      examples: getRepoSignal(repo, "examples"),
      ci: getRepoSignal(repo, "ci"),
      docker: getRepoSignal(repo, "docker")
    }
  };

  return [
    "你是 GitHub 学习雷达的项目分析器。",
    "只能使用给定 JSON 输入，不允许浏览网页，不允许补充外部事实。",
    "所有面向用户的内容使用简洁中文，输出必须严格符合 schema。",
    ...getLearnerCommunicationGuidance(preference.level),
    "oneLineSummary 必须回答这个仓库具体解决什么问题、主要输入或操作是什么、会得到什么结果；不得只改写语言、类别和标签。",
    "whyLearn 每一项必须指出这个仓库特有的技术、文件信号或可练习能力，不得使用‘工程结构较好’之类无法验证的空话。",
    "miniCloneScope.goal 必须说明 mini 版本的用户输入、核心处理和可观察输出，并明确缩小后的边界。",
    "coreFeatures 使用仓库特有的模块或能力名称。除非输入证据明确支持，否则禁止使用‘核心输入表单或配置’、‘主处理流程’、‘结果展示’这类通用占位词。",
    "证据不足时明确写‘需要先确认’，降低 confidence，不得猜测仓库不存在的功能或文件。",
    "3 天学习路线必须围绕该仓库的 mini 复刻，任务要具体、可执行、适合个人练习。",
    JSON.stringify({
      promptVersion: repositoryAnalysisPromptVersion,
      schemaVersion: repositoryAnalysisSchemaVersion,
      repo: compactRepo,
      score,
      preference
    })
  ];
}

function expandAiAnalysis(repo: RepoSnapshot, object: z.infer<typeof aiRepoAnalysisSchema>): RepoAnalysis {
  const extendedPlan = makeRuleBasedPlan(repo.name);
  const parsed = repoAnalysisSchema.parse({
    ...object,
    learningPlan: {
      plan3Days: object.learningPlan.plan3Days,
      plan7Days: extendedPlan.plan7Days,
      plan14Days: extendedPlan.plan14Days
    }
  });

  return {
    repoId: repo.id,
    ...parsed
  };
}

function getFallbackAnalysis(repo: RepoSnapshot, score: RuleScore, preference: UserPreference) {
  const seedFallback = seedAnalyses.find((analysis) => analysis.repoId === repo.id);

  if (seedFallback) {
    return {
      analysis: seedFallback,
      source: "seed" as const
    };
  }

  return {
    analysis: createRuleBasedAnalysis(repo, score, preference),
    source: "rule" as const
  };
}

export function createRuleBasedAnalysis(
  repo: RepoSnapshot,
  score: RuleScore,
  preference: UserPreference
): RepoAnalysis {
  const difficulty = repo.sizeKb > 40000 || repo.primaryLanguage === "Rust" ? "advanced" : "intermediate";
  const topicTags = repo.topics.slice(0, 4);
  const projectType = inferProjectType(repo);
  const coreFeatures = inferRuleCoreFeatures(repo);
  const cloneGoal = `制作 ${repo.name}-lite：实现“${coreFeatures[0]}”，再接通“${coreFeatures[1]}”与“${coreFeatures[2]}”，形成可以运行和验证的最小闭环。`;

  return {
    repoId: repo.id,
    projectType,
    oneLineSummary: `${repo.name} 主要围绕“${coreFeatures[0]}”和“${coreFeatures[1]}”展开，可用 ${repo.primaryLanguage} 复现从操作入口到可验证结果的最小路径。`,
    learningTags: Array.from(new Set([repo.primaryLanguage, ...topicTags])).slice(0, 6),
    difficulty,
    whyLearn: [
      `可以练习“${coreFeatures[0]}”与“${coreFeatures[1]}”之间的真实衔接`,
      score.reasons[0] ?? `仓库主题和 ${repo.primaryLanguage} 技术栈符合当前雷达规则`,
      getRepoSignal(repo, "examples") === "present"
        ? "仓库包含示例，可以先复现再缩小为个人版本"
        : getRepoSignal(repo, "examples") === "absent"
          ? "已检查但未发现示例，需要从 README 和目录结构提炼核心流程"
          : "示例抓取状态未知，需要先确认入口和示例再确定复刻路径",
      preference.languages.includes(repo.primaryLanguage)
        ? `${repo.primaryLanguage} 与你的语言偏好一致`
        : `可以借此补充 ${repo.primaryLanguage} 项目经验`
    ],
    miniCloneScope: {
      goal: cloneGoal,
      coreFeatures,
      excludedFeatures: ["完整多用户系统", "复杂权限/计费", "原项目的所有高级能力"]
    },
    recommendedFor: ["想通过开源项目做作品集的人", "愿意从真实项目拆解工程结构的人"],
    notRecommendedFor:
      difficulty === "advanced" ? ["只想完成入门 CRUD 的学习者"] : ["完全不熟悉基础开发工具链的人"],
    risks: score.risks.length > 0 ? score.risks : ["这是规则 fallback 分析，建议进入 GitHub 仓库后再确认细节"],
    confidence: 0.62,
    learningPlan: makeRuleBasedPlan(repo.name)
  };
}

export function upgradeLegacyRecommendationContent(
  item: RadarRecommendation,
  preference: UserPreference = defaultPreference
): RadarRecommendation {
  const { analysis } = item;
  const legacySummary = /^适合围绕 .+ 做 mini 复刻，当前规则分 \d+。?$/.test(analysis.oneLineSummary.trim());
  const legacyMini =
    /^复刻一个 .+ lite，保留最能体现 .+ 学习价值的核心流程。?$/.test(analysis.miniCloneScope.goal.trim()) ||
    ["核心输入表单或配置", "主处理流程", "结果展示"].every((feature) =>
      analysis.miniCloneScope.coreFeatures.includes(feature)
    );
  const legacyReasons = analysis.whyLearn.some(
    (reason) =>
      /^学习雷达分 \d+$/.test(reason) ||
      reason === "可从 README 和目录结构提炼核心流程" ||
      reason === "仓库包含示例，适合裁剪学习"
  );

  if (!legacySummary && !legacyMini && !legacyReasons) return item;

  const replacement = createRuleBasedAnalysis(item.repo, item.score, preference);
  return {
    ...item,
    analysis: {
      ...analysis,
      oneLineSummary: legacySummary ? replacement.oneLineSummary : analysis.oneLineSummary,
      whyLearn: legacyReasons ? replacement.whyLearn : analysis.whyLearn,
      miniCloneScope: legacyMini ? replacement.miniCloneScope : analysis.miniCloneScope
    }
  };
}

function inferRuleCoreFeatures(repo: RepoSnapshot) {
  const topicEvidence = [repo.name, repo.description, ...repo.topics]
    .join(" ")
    .toLowerCase();
  const featureRules: Array<[RegExp, string]> = [
    [/parallel-agents|parallel agents|fleet of .*agents|agent-orchestration|\borchestration\b/, "并行 Agent 编排"],
    [/worktrees?|workspace isolation/, "Git Worktree 隔离"],
    [/\bterminal\b|ghostty/, "终端会话管理"],
    [/react-devtools|live devtools|running react/, "React 运行时检查"],
    [/tanstack-query|tanstack-router|\btanstack\b/, "TanStack 状态调试"],
    [/react-native|\bexpo\b|mobile-app/, "跨端应用调试"],
    [/erd-diagram|erd builder|database design/, "ERD 数据建模"],
    [/flowcharts?|drawing-app|drawings?|excalidraw/, "流程图与画布编辑"],
    [/tiptap|notes?|documentation tool/, "文档与笔记编辑"],
    [/model-context-protocol|\bmcp\b/, "MCP 服务连接"],
    [/ai-agents|agentic|agent-ide|devtools-agent|react-agent|coding agent/, "AI Agent 接入"],
    [/codegen|code-generator|generate.*code|ai-coding/, "代码生成"],
    [/\bcli\b|command-line|commander/, "命令参数解析"],
    [/workflow|orchestrat|pipeline/, "工作流编排"],
    [/react|vue|svelte|frontend|\bui\b/, "交互界面"],
    [/search|retriev|vector|embedding/, "搜索与检索"],
    [/database|postgres|sqlite|mysql|storage/, "数据存储"],
    [/\bapi\b|server|backend/, "API 请求处理"],
    [/monitor|observab|status/, "状态监测"],
    [/editor|language-server|\blsp\b/, "编辑器协议交互"],
    [/auth|oauth|permission/, "身份与权限校验"]
  ];
  const matched = featureRules.filter(([pattern]) => pattern.test(topicEvidence)).map(([, label]) => label);

  return Array.from(
    new Set([
      ...matched,
      `${repo.name} 主路径`,
      `${repo.primaryLanguage} 核心逻辑`,
      "可验证结果输出"
    ])
  ).slice(0, 4);
}

function inferProjectType(repo: RepoSnapshot) {
  if (repo.category === "ai-app") return "AI application";
  if (repo.category === "devtool") return "Developer tool";
  if (repo.category === "database") return "Database project";
  if (repo.category === "cli") return "CLI tool";
  return "Full-stack project";
}

function makeRuleBasedPlan(name: string) {
  return {
    plan3Days: [
      {
        day: 1,
        goal: `拆解 ${name} 的核心流程`,
        tasks: ["阅读 README", "列出核心模块", "确定 mini 复刻范围"],
        deliverable: "一页项目拆解笔记"
      },
      {
        day: 2,
        goal: "实现 mini 版主流程",
        tasks: ["搭建项目骨架", "实现核心数据结构", "跑通主路径"],
        deliverable: "可运行 demo"
      },
      {
        day: 3,
        goal: "完善展示和交付",
        tasks: ["补空状态和错误状态", "写 README", "整理截图或录屏"],
        deliverable: "可放入作品集的 mini 版本"
      }
    ],
    plan7Days: Array.from({ length: 7 }, (_, index) => ({
      day: index + 1,
      goal: index < 2 ? "研究与裁剪" : index < 5 ? "核心实现" : "测试与交付",
      tasks:
        index < 2
          ? ["源码走读", "写功能边界"]
          : index < 5
            ? ["实现一个核心模块", "补状态处理"]
            : ["补测试", "写交付文档"],
      deliverable: index === 6 ? "完整 mini 复刻版本" : "阶段性提交"
    })),
    plan14Days: Array.from({ length: 14 }, (_, index) => ({
      day: index + 1,
      goal: index < 3 ? "源码研究" : index < 10 ? "模块实现" : "部署复盘",
      tasks:
        index < 3
          ? ["读文档", "画数据流", "定范围"]
          : index < 10
            ? ["实现模块", "记录问题"]
            : ["测试", "部署", "复盘"],
      deliverable: index === 13 ? "可展示的复刻项目和复盘文章" : "阶段性提交"
    }))
  };
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
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
