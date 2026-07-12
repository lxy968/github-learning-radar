export function shouldRequireGithubTokenAtWebEdge(env: { NODE_ENV?: string } = process.env) {
  return env.NODE_ENV !== "production";
}
