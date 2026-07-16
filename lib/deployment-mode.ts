export const deploymentModeEnvironmentVariable = "APP_DEPLOYMENT_MODE";

export type DeploymentMode = "showcase" | "full";

type DeploymentModeEnvironment = {
  APP_DEPLOYMENT_MODE?: string;
  NODE_ENV?: string;
};

export function getDeploymentMode(env: DeploymentModeEnvironment = process.env): DeploymentMode {
  const configured = env.APP_DEPLOYMENT_MODE?.trim().toLowerCase();
  if (configured === "showcase" || configured === "full") return configured;

  // A missing or invalid production setting must fail closed: public deployments
  // may read existing data, but cannot create or execute paid background work.
  return env.NODE_ENV === "production" ? "showcase" : "full";
}

export function isShowcaseMode(env: DeploymentModeEnvironment = process.env) {
  return getDeploymentMode(env) === "showcase";
}

export function assertBackgroundJobsEnabled(
  operation: string,
  env: DeploymentModeEnvironment = process.env
) {
  if (isShowcaseMode(env)) {
    throw new Error(`${deploymentModeEnvironmentVariable}=showcase forbids ${operation}.`);
  }
}

export const showcaseReadOnlyError = {
  status: "error" as const,
  code: "showcase_read_only",
  message: "当前是线上作品集版，只展示预置内容，不会创建后台任务或调用 DeepSeek。Fork 后使用 full 模式并在自己的 Worker 配置 Key，即可启用生成。"
};
