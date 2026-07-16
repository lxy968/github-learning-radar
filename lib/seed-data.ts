import { showcaseRecommendation } from "@/lib/showcase-content";
import type { RepoAnalysis, RepoSnapshot, UserPreference } from "@/lib/types";

export const defaultPreference: UserPreference = {
  interests: ["ai-app", "frontend", "devtool", "automation", "cli"],
  languages: ["TypeScript", "Python", "Go"],
  level: "intermediate",
  goal: "clone",
  refreshInterval: "daily"
};

const seedRepoFixtures: RepoSnapshot[] = [
  showcaseRecommendation.repo,
  {
    id: 92001,
    fullName: "modelcontextprotocol/inspector",
    owner: "modelcontextprotocol",
    name: "inspector",
    description: "A developer tool for inspecting and debugging MCP servers.",
    url: "https://github.com/modelcontextprotocol/inspector",
    homepage: "https://modelcontextprotocol.io",
    topics: ["mcp", "debugging", "devtools", "ai"],
    category: "devtool",
    primaryLanguage: "TypeScript",
    languages: [
      { name: "TypeScript", bytes: 720000 },
      { name: "CSS", bytes: 42000 }
    ],
    stars: 9200,
    forks: 780,
    openIssues: 52,
    license: "MIT",
    createdAt: "2024-11-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    pushedAt: "2026-07-07T00:00:00.000Z",
    readmeExcerpt:
      "Inspector provides a UI for connecting to MCP servers, viewing tools, resources, prompts, and testing server responses during development.",
    detectedFiles: ["package.json", "src", "components", "tests", ".github/workflows"],
    hasTests: true,
    hasExamples: true,
    hasCi: true,
    hasDocker: false,
    dependencies: ["react", "vite", "typescript"],
    dailyStarDelta: 186,
    weeklyStarDelta: 980,
    sizeKb: 14500
  },
  {
    id: 92002,
    fullName: "browser-use/web-ui",
    owner: "browser-use",
    name: "web-ui",
    description: "A web dashboard for browser automation agents.",
    url: "https://github.com/browser-use/web-ui",
    topics: ["browser-automation", "agents", "ai", "nextjs"],
    category: "ai-app",
    primaryLanguage: "Python",
    languages: [
      { name: "Python", bytes: 890000 },
      { name: "TypeScript", bytes: 260000 }
    ],
    stars: 15400,
    forks: 2100,
    openIssues: 134,
    license: "Apache-2.0",
    createdAt: "2025-01-14T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
    pushedAt: "2026-07-06T00:00:00.000Z",
    readmeExcerpt:
      "A web interface for running browser automation tasks, managing agent settings, and observing execution traces.",
    detectedFiles: ["pyproject.toml", "app", "frontend", "examples", "Dockerfile"],
    hasTests: true,
    hasExamples: true,
    hasCi: false,
    hasDocker: true,
    dependencies: ["fastapi", "playwright", "nextjs"],
    dailyStarDelta: 230,
    weeklyStarDelta: 1430,
    sizeKb: 28800
  },
  {
    id: 92003,
    fullName: "electric-sql/pglite",
    owner: "electric-sql",
    name: "pglite",
    description: "Postgres embedded in WebAssembly for local-first apps.",
    url: "https://github.com/electric-sql/pglite",
    topics: ["postgres", "wasm", "local-first", "database"],
    category: "database",
    primaryLanguage: "TypeScript",
    languages: [
      { name: "TypeScript", bytes: 640000 },
      { name: "C", bytes: 430000 }
    ],
    stars: 13200,
    forks: 520,
    openIssues: 88,
    license: "Apache-2.0",
    createdAt: "2023-09-24T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:00.000Z",
    pushedAt: "2026-07-05T00:00:00.000Z",
    readmeExcerpt:
      "PGlite packages Postgres for browser, Node, and edge runtimes, with examples for local-first storage and sync experiments.",
    detectedFiles: ["packages", "examples", "docs", "vitest.config.ts", ".github/workflows"],
    hasTests: true,
    hasExamples: true,
    hasCi: true,
    hasDocker: false,
    dependencies: ["typescript", "vite", "postgres"],
    dailyStarDelta: 92,
    weeklyStarDelta: 570,
    sizeKb: 51000
  },
  {
    id: 92004,
    fullName: "openstatusHQ/openstatus",
    owner: "openstatusHQ",
    name: "openstatus",
    description: "Open-source synthetic monitoring and status page platform.",
    url: "https://github.com/openstatusHQ/openstatus",
    topics: ["monitoring", "status-page", "nextjs", "turso"],
    category: "fullstack",
    primaryLanguage: "TypeScript",
    languages: [
      { name: "TypeScript", bytes: 1480000 },
      { name: "MDX", bytes: 88000 }
    ],
    stars: 8200,
    forks: 640,
    openIssues: 41,
    license: "AGPL-3.0",
    createdAt: "2023-06-02T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
    pushedAt: "2026-07-06T00:00:00.000Z",
    readmeExcerpt:
      "OpenStatus includes cron checks, incident pages, analytics, auth, billing-ready app structure, and deployment examples.",
    detectedFiles: ["apps/web", "packages", "drizzle", "tests", ".github/workflows"],
    hasTests: true,
    hasExamples: true,
    hasCi: true,
    hasDocker: true,
    dependencies: ["next", "drizzle", "trpc", "tailwind"],
    dailyStarDelta: 74,
    weeklyStarDelta: 410,
    sizeKb: 42000
  },
  {
    id: 92005,
    fullName: "supabase-community/postgres-language-server",
    owner: "supabase-community",
    name: "postgres-language-server",
    description: "Language server for Postgres with diagnostics and editor tooling.",
    url: "https://github.com/supabase-community/postgres-language-server",
    topics: ["postgres", "lsp", "devtools", "sql"],
    category: "devtool",
    primaryLanguage: "Rust",
    languages: [
      { name: "Rust", bytes: 970000 },
      { name: "SQL", bytes: 120000 }
    ],
    stars: 6400,
    forks: 310,
    openIssues: 28,
    license: "Apache-2.0",
    createdAt: "2024-05-16T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z",
    pushedAt: "2026-07-04T00:00:00.000Z",
    readmeExcerpt:
      "A language server that provides schema-aware completion, linting, and diagnostics for Postgres projects.",
    detectedFiles: ["Cargo.toml", "crates", "tests", ".github/workflows"],
    hasTests: true,
    hasExamples: false,
    hasCi: true,
    hasDocker: false,
    dependencies: ["tower-lsp", "tokio", "postgres"],
    dailyStarDelta: 45,
    weeklyStarDelta: 260,
    sizeKb: 21800
  },
  {
    id: 92006,
    fullName: "upstash/context7",
    owner: "upstash",
    name: "context7",
    description: "Docs context service for coding assistants.",
    url: "https://github.com/upstash/context7",
    topics: ["ai", "documentation", "developer-tools", "mcp"],
    category: "ai-app",
    primaryLanguage: "TypeScript",
    languages: [
      { name: "TypeScript", bytes: 530000 },
      { name: "JavaScript", bytes: 90000 }
    ],
    stars: 20300,
    forks: 1320,
    openIssues: 65,
    license: "MIT",
    createdAt: "2025-04-04T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    pushedAt: "2026-07-07T00:00:00.000Z",
    readmeExcerpt:
      "Context7 retrieves version-aware docs and exposes them to assistants through MCP-compatible interfaces.",
    detectedFiles: ["package.json", "src", "examples", "README.md", ".github/workflows"],
    hasTests: false,
    hasExamples: true,
    hasCi: true,
    hasDocker: false,
    dependencies: ["mcp", "typescript", "hono"],
    dailyStarDelta: 310,
    weeklyStarDelta: 1890,
    sizeKb: 9800
  }
];

export const seedRepos: RepoSnapshot[] = seedRepoFixtures.map((repo) => ({
  ...repo,
  enrichment: {
    readme: repo.readmeExcerpt ? "present" : "absent",
    languages: repo.languages.length > 0 ? "present" : "absent",
    rootFiles: "present",
    tests: repo.hasTests ? "present" : "absent",
    examples: repo.hasExamples ? "present" : "absent",
    ci: repo.hasCi ? "present" : "absent",
    docker: repo.hasDocker ? "present" : "absent"
  }
}));

export const seedAnalyses: RepoAnalysis[] = [
  showcaseRecommendation.analysis,
  {
    repoId: 92001,
    projectType: "AI developer tool",
    oneLineSummary: "适合复刻一个 MCP 工具调试台，练习协议连接、工具调用和可观测 UI。",
    learningTags: ["MCP", "DevTools", "React", "协议调试"],
    difficulty: "intermediate",
    whyLearn: ["AI 工具生态正在快速标准化", "功能边界适中，适合做 mini 调试台", "能练到真实开发者工具的信息架构"],
    miniCloneScope: {
      goal: "做一个本地 MCP server inspector lite。",
      coreFeatures: ["连接 server", "展示 tools/resources", "执行工具调用", "记录响应历史"],
      excludedFeatures: ["完整认证系统", "多用户协作", "远程部署市场"]
    },
    recommendedFor: ["想做 AI 工具链的人", "想练习协议 UI 的前端/全栈开发者"],
    notRecommendedFor: ["完全没接触过 TypeScript 的初学者"],
    risks: ["需要先理解 MCP 基本概念"],
    confidence: 0.88,
    learningPlan: makePlan("MCP Inspector Lite", "连接并调试一个本地工具服务")
  },
  {
    repoId: 92002,
    projectType: "AI automation app",
    oneLineSummary: "适合复刻一个浏览器自动化任务面板，练习 agent 控制台、任务状态和执行日志。",
    learningTags: ["AI Agent", "Playwright", "FastAPI", "任务编排"],
    difficulty: "advanced",
    whyLearn: ["浏览器 agent 是 AI 应用热点", "能学习任务状态、日志和人机协同 UI", "适合作为作品集项目"],
    miniCloneScope: {
      goal: "做一个输入任务并观察浏览器执行日志的 automation console。",
      coreFeatures: ["任务表单", "运行状态", "步骤日志", "结果截图占位"],
      excludedFeatures: ["真实多浏览器集群", "账号托管", "复杂 agent 自主规划"]
    },
    recommendedFor: ["想做 AI agent 应用的人", "有一点后端基础的全栈开发者"],
    notRecommendedFor: ["只想练静态页面的人"],
    risks: ["Playwright 环境和 agent 失败重试会增加复杂度"],
    confidence: 0.84,
    learningPlan: makePlan("Browser Agent Console", "跑通一个可观察的浏览器自动化任务")
  },
  {
    repoId: 92003,
    projectType: "Database infrastructure",
    oneLineSummary: "适合读源码和做 demo，复刻方向可选本地优先 Todo + 浏览器数据库实验。",
    learningTags: ["Postgres", "WASM", "Local-first", "Database"],
    difficulty: "advanced",
    whyLearn: ["数据库进入前端/边缘运行时是重要趋势", "能理解本地优先架构", "适合深入技术研究"],
    miniCloneScope: {
      goal: "做一个浏览器内运行 SQL 的 local-first notebook。",
      coreFeatures: ["初始化本地 DB", "执行 SQL", "保存查询片段", "导入示例数据"],
      excludedFeatures: ["完整 Postgres 移植", "同步协议", "多人协作"]
    },
    recommendedFor: ["对数据库和本地优先感兴趣的人"],
    notRecommendedFor: ["急着做简单作品集的人"],
    risks: ["底层实现较深，mini 复刻应避开数据库内核"],
    confidence: 0.8,
    learningPlan: makePlan("Local SQL Notebook", "用浏览器本地数据库完成可交互 SQL demo")
  },
  {
    repoId: 92004,
    projectType: "Full-stack SaaS",
    oneLineSummary: "适合复刻一个状态页 SaaS，练习监控任务、状态展示和全栈产品闭环。",
    learningTags: ["Next.js", "Monitoring", "Drizzle", "SaaS"],
    difficulty: "intermediate",
    whyLearn: ["业务闭环清晰", "页面、数据库、定时任务都有代表性", "很适合做作品集"],
    miniCloneScope: {
      goal: "做一个单用户 uptime status page。",
      coreFeatures: ["添加监控 URL", "定时检查", "状态页", "事件记录"],
      excludedFeatures: ["团队计费", "全球探针", "复杂告警渠道"]
    },
    recommendedFor: ["想练全栈工程闭环的人"],
    notRecommendedFor: ["只想看 AI 项目的人"],
    risks: ["AGPL 许可证需要注意复用边界"],
    confidence: 0.9,
    learningPlan: makePlan("Status Page Mini", "完成一个可展示的单用户监控状态页")
  },
  {
    repoId: 92005,
    projectType: "Language server",
    oneLineSummary: "适合做进阶源码阅读，mini 复刻可实现一个 SQL lint language server。",
    learningTags: ["Rust", "LSP", "Postgres", "Editor tooling"],
    difficulty: "advanced",
    whyLearn: ["LSP 是编辑器工具的核心协议", "SQL 场景清晰", "适合提升系统设计和 Rust 工程能力"],
    miniCloneScope: {
      goal: "做一个最小 SQL LSP，支持诊断和关键词补全。",
      coreFeatures: ["LSP server", "SQL parse/lint", "completion", "VS Code 调试配置"],
      excludedFeatures: ["完整 schema introspection", "远程数据库连接", "高级优化建议"]
    },
    recommendedFor: ["想做开发者工具的人", "想练 Rust 工程的人"],
    notRecommendedFor: ["入门前端学习者"],
    risks: ["协议和 Rust 学习曲线偏陡"],
    confidence: 0.78,
    learningPlan: makePlan("SQL LSP Mini", "实现一个能在编辑器里提示 SQL 的最小服务")
  },
  {
    repoId: 92006,
    projectType: "AI docs infrastructure",
    oneLineSummary: "适合复刻一个文档检索 MCP 服务，练习结构化内容索引和 assistant 上下文供给。",
    learningTags: ["MCP", "RAG", "Docs", "AI Infra"],
    difficulty: "intermediate",
    whyLearn: ["直接对应 AI 编程助手的上下文痛点", "mini 版本可控", "能练到 API、缓存、检索和协议输出"],
    miniCloneScope: {
      goal: "做一个读取文档目录并通过 API 返回相关片段的 docs context server。",
      coreFeatures: ["导入 markdown", "关键词检索", "返回结构化片段", "MCP tool wrapper"],
      excludedFeatures: ["全网文档爬虫", "向量数据库", "多版本大型索引"]
    },
    recommendedFor: ["想做 AI infra/开发工具的人"],
    notRecommendedFor: ["只想练 CRUD 的初学者"],
    risks: ["需要把检索范围收窄，否则容易变成通用总结器"],
    confidence: 0.87,
    learningPlan: makePlan("Docs Context Server", "完成一个可给助手提供文档片段的最小服务")
  }
];

function makePlan(title: string, outcome: string) {
  return {
    plan3Days: [
      {
        day: 1,
        goal: `拆解 ${title} 的核心数据流`,
        tasks: ["读 README 和目录结构", "画出输入/处理/输出", "确定 mini 版功能边界"],
        deliverable: "一页功能边界和模块图"
      },
      {
        day: 2,
        goal: "实现最小可用核心流程",
        tasks: ["搭建项目", "实现核心数据模型", "完成主流程页面或接口"],
        deliverable: "能本地跑通的核心 demo"
      },
      {
        day: 3,
        goal: "打磨成可展示作品",
        tasks: ["补错误态", "写 README", "录制或截图展示"],
        deliverable: outcome
      }
    ],
    plan7Days: Array.from({ length: 7 }, (_, index) => ({
      day: index + 1,
      goal:
        index < 2
          ? "理解原项目和裁剪范围"
          : index < 5
            ? "实现 mini 版核心功能"
            : "完善体验和交付材料",
      tasks:
        index < 2
          ? ["阅读 README", "梳理模块", "确定技术栈"]
          : index < 5
            ? ["实现主流程", "加入状态管理", "补基本错误处理"]
            : ["补测试", "写 README", "整理作品集说明"],
      deliverable: index === 6 ? outcome : "当天可验收的小功能"
    })),
    plan14Days: Array.from({ length: 14 }, (_, index) => ({
      day: index + 1,
      goal:
        index < 3
          ? "研究和设计"
          : index < 10
            ? "分模块实现"
            : "测试、部署和复盘",
      tasks:
        index < 3
          ? ["源码走读", "写设计笔记", "列出取舍"]
          : index < 10
            ? ["实现一个模块", "记录问题", "提交可运行版本"]
            : ["补测试", "部署", "写复盘文章"],
      deliverable: index === 13 ? outcome : "阶段性提交"
    }))
  };
}
