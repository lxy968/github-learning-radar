import { createOpenAI as createOpenAICompatible } from "@ai-sdk/openai";

const defaultDeepSeekBaseUrl = "https://api.deepseek.com";
const defaultDeepSeekFlashModel = "deepseek-v4-flash";
const defaultDeepSeekProModel = "deepseek-v4-pro";

export type AiModelTask = "radar-analysis" | "detailed-study-plan";

export type AiModelConfig = {
  provider: "deepseek";
  task: AiModelTask;
  modelId: string;
  model: ReturnType<ReturnType<typeof createOpenAICompatible>>;
};

export function getConfiguredAiModel(
  task: AiModelTask,
  env: NodeJS.ProcessEnv = process.env
): AiModelConfig | null {
  if (env.DEEPSEEK_API_KEY) {
    const deepseek = createOpenAICompatible({
      apiKey: env.DEEPSEEK_API_KEY,
      baseURL: stripTrailingSlash(env.DEEPSEEK_BASE_URL ?? defaultDeepSeekBaseUrl),
      name: "deepseek"
    });

    const modelId = getAiModelId(task, env);

    return {
      provider: "deepseek",
      task,
      modelId,
      model: deepseek.chat(modelId)
    };
  }

  return null;
}

export function getAiModelId(task: AiModelTask, env: NodeJS.ProcessEnv = process.env) {
  if (task === "radar-analysis") {
    return env.DEEPSEEK_FLASH_MODEL?.trim() || defaultDeepSeekFlashModel;
  }

  return env.DEEPSEEK_PRO_MODEL?.trim() || env.DEEPSEEK_MODEL?.trim() || defaultDeepSeekProModel;
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
