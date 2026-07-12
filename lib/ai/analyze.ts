import { generateText } from "ai";
import { z } from "zod";
import { getConfiguredAiModel, type AiModelConfig } from "@/lib/ai/provider";
import { classifyOperationalError } from "@/lib/operational-errors";
import { getRepoSignal } from "@/lib/repository-signals";
import { sanitizeReadmeExcerpt } from "@/lib/readme";
import { seedAnalyses } from "@/lib/seed-data";
import type { AiProviderAttempt, RepoAnalysis, RepoSnapshot, RuleScore, UserPreference } from "@/lib/types";

export const repositoryAnalysisPromptVersion = "radar-analysis-prompt-v1";
export const repositoryAnalysisSchemaVersion = "radar-analysis-schema-v1";

const planDaySchema = z.object({
  day: z.number(),
  goal: z.string(),
  tasks: z.array(z.string()).min(2).max(5),
  deliverable: z.string()
});

const repoAnalysisFields = {
  projectType: z.string(),
  oneLineSummary: z.string(),
  learningTags: z.array(z.string()).min(2).max(8),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
  whyLearn: z.array(z.string()).min(2).max(5),
  miniCloneScope: z.object({
    goal: z.string(),
    coreFeatures: z.array(z.string()).min(2).max(6),
    excludedFeatures: z.array(z.string()).min(1).max(6)
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
  const configuredModel = getConfiguredAiModel();

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
  const { text, usage } = await generateText({
    model,
    abortSignal,
    maxRetries: 2,
    temperature: 0.2,
    prompt: [
      ...buildAnalysisPrompt(repo, score, preference),
      "DeepSeek 当前不使用 response_format。你必须只返回一个 JSON 对象。",
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
  const jsonText = extractJsonObject(text);
  const parsed = aiRepoAnalysisSchema.safeParse(JSON.parse(jsonText));

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
    readmeExcerpt: sanitizeReadmeExcerpt(repo.readmeExcerpt, 900),
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
    "输出必须严格符合 schema，3 天学习路线必须围绕 mini 复刻，任务要具体、可执行、适合个人练习。",
    "请优先解释这个仓库为什么值得学习、如何裁剪复刻、以及 3 天内怎么推进。",
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

function extractJsonObject(text: string) {
  const trimmed = text.trim();

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Continue with tolerant extraction below.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  throw new Error("AI did not return a JSON object");
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
  const cloneGoal = `复刻一个 ${repo.name} lite，保留最能体现 ${repo.primaryLanguage} 和 ${repo.category} 学习价值的核心流程。`;

  return {
    repoId: repo.id,
    projectType,
    oneLineSummary: `适合围绕 ${repo.primaryLanguage} / ${topicTags.join(", ") || repo.category} 做 mini 复刻，当前规则分 ${score.finalScore}。`,
    learningTags: Array.from(new Set([repo.primaryLanguage, ...topicTags])).slice(0, 6),
    difficulty,
    whyLearn: [
      score.reasons[0] ?? "命中今日学习雷达规则",
      getRepoSignal(repo, "examples") === "present"
        ? "仓库包含示例，适合裁剪学习"
        : getRepoSignal(repo, "examples") === "absent"
          ? "已检查但未发现示例，需要从 README 和目录结构提炼核心流程"
          : "示例抓取状态未知，进入仓库后先确认再确定复刻路径",
      preference.languages.includes(repo.primaryLanguage) ? "命中你的语言偏好" : "可扩展你的技术视野"
    ],
    miniCloneScope: {
      goal: cloneGoal,
      coreFeatures: ["核心输入表单或配置", "主处理流程", "结果展示", "基础错误状态"],
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
