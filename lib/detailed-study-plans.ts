import { promises as fs } from "fs";
import path from "path";
import { extendDetailedStudyPlan, generateDetailedStudyPlan } from "@/lib/ai/detailed-study-plan";
import { getSqlClient } from "@/lib/db/client";
import {
  buildDetailedStudyPlanCacheMetadata,
  createDetailedStudyPlanGenerationContext,
  isDetailedStudyPlanCacheMatch,
  type DetailedStudyPlanGenerationContext
} from "@/lib/detailed-study-plan-cache";
import type {
  DetailedStudyPlan,
  DetailedStudyPlanDuration,
  RadarRecommendation,
  UserPreference
} from "@/lib/types";

type DetailedStudyPlanStore = {
  plans: DetailedStudyPlan[];
};

type GeneratePlan = (
  recommendation: RadarRecommendation,
  duration: DetailedStudyPlanDuration,
  context: DetailedStudyPlanGenerationContext
) => Promise<DetailedStudyPlan>;

type ExtendPlan = (
  recommendation: RadarRecommendation,
  existingPlan: DetailedStudyPlan,
  context: DetailedStudyPlanGenerationContext
) => Promise<DetailedStudyPlan>;

const dataDir = path.join(process.cwd(), ".data");
const activeGenerations = new Map<string, Promise<{ plan: DetailedStudyPlan; cached: boolean }>>();

export async function listDetailedStudyPlans(repoId?: number) {
  const sql = getSqlClient();

  if (sql) {
    const rows = repoId === undefined
      ? await sql`
          SELECT plan
          FROM detailed_study_plans
          ORDER BY generated_at DESC
        `
      : await sql`
          SELECT plan
          FROM detailed_study_plans
          WHERE repo_id = ${repoId}
          ORDER BY generated_at DESC
        `;

    return rows.map(mapPlanRow).filter((plan): plan is DetailedStudyPlan => plan !== null);
  }

  const store = await readStore();
  const plans = repoId === undefined ? store.plans : store.plans.filter((plan) => plan.repoId === repoId);
  return [...plans].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export async function getOrCreateDetailedStudyPlan(
  recommendation: RadarRecommendation,
  duration: DetailedStudyPlanDuration,
  options: {
    preference: Pick<UserPreference, "level" | "goal">;
    force?: boolean;
    extend?: boolean;
    generate?: GeneratePlan;
    extendPlan?: ExtendPlan;
  }
) {
  const context = createDetailedStudyPlanGenerationContext(recommendation, duration, options.preference);
  const generationKey = `${context.cache.key}:${options.extend ? "extend" : "initial"}`;
  const existingGeneration = activeGenerations.get(generationKey);
  if (existingGeneration) return existingGeneration;

  const generation = createOrReusePlan(recommendation, duration, context, options);
  activeGenerations.set(generationKey, generation);

  try {
    return await generation;
  } finally {
    if (activeGenerations.get(generationKey) === generation) activeGenerations.delete(generationKey);
  }
}

async function createOrReusePlan(
  recommendation: RadarRecommendation,
  duration: DetailedStudyPlanDuration,
  context: ReturnType<typeof createDetailedStudyPlanGenerationContext>,
  options: {
    preference: Pick<UserPreference, "level" | "goal">;
    force?: boolean;
    extend?: boolean;
    generate?: GeneratePlan;
    extendPlan?: ExtendPlan;
  }
) {
  if (options.extend) {
    const cached = await findPlanByCacheKey(recommendation.repo.id, context.cache.key);
    if (!cached) throw new Error("还没有可以继续生成的学习方案，请先生成第一阶段。");
    if ((cached.generatedThroughDay ?? cached.days.length) >= duration) return { plan: cached, cached: true };

    const extendPlan = options.extendPlan ?? extendDetailedStudyPlan;
    const extended = await extendPlan(recommendation, cached, context);
    const plan = { ...extended, cache: context.cache };
    await saveDetailedStudyPlan(plan);
    return { plan, cached: false };
  }

  if (!options.force) {
    const cached = await findPlanByCacheKey(recommendation.repo.id, context.cache.key);
    if (cached) return { plan: cached, cached: true };
  }

  const generate = options.generate ?? generateDetailedStudyPlan;
  const generated = await generate(recommendation, duration, context);
  const plan = { ...generated, cache: context.cache };
  await saveDetailedStudyPlan(plan);
  return { plan, cached: false };
}

async function findPlanByCacheKey(repoId: number, cacheKey: string) {
  const plans = await listDetailedStudyPlans(repoId);
  return plans.find((plan) => plan.cache?.key === cacheKey) ?? null;
}

export async function getCachedDetailedStudyPlan(
  recommendation: RadarRecommendation,
  duration: DetailedStudyPlanDuration,
  preference: Pick<UserPreference, "level" | "goal">
) {
  const expected = buildDetailedStudyPlanCacheMetadata(recommendation, duration, preference);
  const plans = await listDetailedStudyPlans(recommendation.repo.id);
  return plans.find((plan) => plan.duration === duration && isDetailedStudyPlanCacheMatch(plan, expected)) ?? null;
}

export async function listCurrentDetailedStudyPlans(
  recommendations: RadarRecommendation[],
  preference: Pick<UserPreference, "level" | "goal">
) {
  if (recommendations.length === 0) return [];
  const expectedKeys = new Set(
    recommendations.flatMap((recommendation) =>
      ([3, 7, 14] as DetailedStudyPlanDuration[]).map(
        (duration) => buildDetailedStudyPlanCacheMetadata(recommendation, duration, preference).key
      )
    )
  );
  const repositoryIds = new Set(recommendations.map((recommendation) => recommendation.repo.id));
  const plans = await listDetailedStudyPlans();
  return plans.filter((plan) => repositoryIds.has(plan.repoId) && Boolean(plan.cache?.key && expectedKeys.has(plan.cache.key)));
}

async function saveDetailedStudyPlan(plan: DetailedStudyPlan) {
  const sql = getSqlClient();

  if (sql) {
    await sql`
      INSERT INTO detailed_study_plans (
        plan_id,
        repo_id,
        repo_full_name,
        duration,
        source,
        based_on_pushed_at,
        generated_at,
        cache_key,
        input_hash,
        preference_level,
        preference_goal,
        prompt_version,
        schema_version,
        cache_provider,
        cache_model,
        plan,
        updated_at
      )
      VALUES (
        ${plan.id},
        ${plan.repoId},
        ${plan.repoFullName},
        ${plan.duration},
        ${plan.source},
        ${plan.basedOnPushedAt},
        ${plan.generatedAt},
        ${plan.cache?.key ?? `legacy:${plan.id}`},
        ${plan.cache?.inputHash ?? "legacy"},
        ${plan.cache?.preferenceLevel ?? "intermediate"},
        ${plan.cache?.preferenceGoal ?? "clone"},
        ${plan.cache?.promptVersion ?? "legacy"},
        ${plan.cache?.schemaVersion ?? "legacy"},
        ${plan.cache?.provider ?? "rule"},
        ${plan.cache?.modelId ?? "legacy"},
        ${sql.json(plan as never)},
        NOW()
      )
      ON CONFLICT (cache_key) DO UPDATE SET
        plan_id = EXCLUDED.plan_id,
        repo_full_name = EXCLUDED.repo_full_name,
        source = EXCLUDED.source,
        based_on_pushed_at = EXCLUDED.based_on_pushed_at,
        generated_at = EXCLUDED.generated_at,
        input_hash = EXCLUDED.input_hash,
        preference_level = EXCLUDED.preference_level,
        preference_goal = EXCLUDED.preference_goal,
        prompt_version = EXCLUDED.prompt_version,
        schema_version = EXCLUDED.schema_version,
        cache_provider = EXCLUDED.cache_provider,
        cache_model = EXCLUDED.cache_model,
        plan = EXCLUDED.plan,
        updated_at = NOW()
    `;

    return plan;
  }

  const store = await readStore();
  const withoutPreviousVersion = store.plans.filter(
    (item) => item.cache?.key !== plan.cache?.key
  );
  const plans = [...withoutPreviousVersion, plan]
    .sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  await writeStore({ plans });
  return plan;
}

function mapPlanRow(row: Record<string, unknown>) {
  if (!row.plan || typeof row.plan !== "object" || Array.isArray(row.plan)) return null;
  return normalizeStoredPlan(row.plan as DetailedStudyPlan);
}

async function readStore(): Promise<DetailedStudyPlanStore> {
  try {
    const content = await fs.readFile(getStoreFile(), "utf8");
    const parsed = JSON.parse(content) as Partial<DetailedStudyPlanStore>;
    return { plans: Array.isArray(parsed.plans) ? parsed.plans.map(normalizeStoredPlan) : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { plans: [] };
    throw error;
  }
}

function normalizeStoredPlan(plan: DetailedStudyPlan): DetailedStudyPlan {
  const generatedThroughDay = plan.generatedThroughDay ?? Math.max(0, ...plan.days.map((day) => day.day));
  return {
    ...plan,
    generatedThroughDay,
    generationStatus: generatedThroughDay >= plan.duration ? "complete" : "partial",
    glossary: Array.isArray(plan.glossary) ? plan.glossary : [],
    providerAttempts: Array.isArray(plan.providerAttempts) ? plan.providerAttempts : [],
    cache:
      plan.cache && typeof plan.cache.key === "string" && typeof plan.cache.inputHash === "string"
        ? plan.cache
        : undefined
  };
}

async function writeStore(store: DetailedStudyPlanStore) {
  const storeFile = getStoreFile();
  await fs.mkdir(path.dirname(storeFile), { recursive: true });
  await fs.writeFile(storeFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function getStoreFile() {
  return process.env.DETAILED_STUDY_PLAN_STORE_FILE
    ? path.resolve(process.env.DETAILED_STUDY_PLAN_STORE_FILE)
    : path.join(dataDir, "detailed-study-plans.json");
}
