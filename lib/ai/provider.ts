import { createOpenAI as createOpenAICompatible } from "@ai-sdk/openai";

const defaultDeepSeekBaseUrl = "https://api.deepseek.com";
const defaultDeepSeekModel = "deepseek-v4-pro";

export type AiModelConfig = {
  provider: "deepseek";
  modelId: string;
  model: ReturnType<ReturnType<typeof createOpenAICompatible>>;
};

export function getConfiguredAiModel(env: NodeJS.ProcessEnv = process.env): AiModelConfig | null {
  if (env.DEEPSEEK_API_KEY) {
    const deepseek = createOpenAICompatible({
      apiKey: env.DEEPSEEK_API_KEY,
      baseURL: stripTrailingSlash(env.DEEPSEEK_BASE_URL ?? defaultDeepSeekBaseUrl),
      name: "deepseek"
    });

    const modelId = env.DEEPSEEK_MODEL ?? defaultDeepSeekModel;

    return {
      provider: "deepseek",
      modelId,
      model: deepseek.chat(modelId)
    };
  }

  return null;
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
