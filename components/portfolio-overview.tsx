import Link from "next/link";
import { ArrowRight, CheckCircle2, ExternalLink, GitFork, KeyRound, Rocket, ShieldCheck, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";

const journeySteps = [
  "补充 README、技术栈与工程信号",
  "规则评分与兴趣匹配",
  "DeepSeek 提炼学习价值和 Mini 复刻范围",
  "生成 3/7/14 天学习任务",
  "保存并同步步骤进度"
];

const engineeringChoices = [
  {
    title: "后台任务",
    body: "GitHub 抓取和完整方案生成可能持续几十秒到数分钟。请求先快速入队，独立 Worker 继续执行；页面刷新或进程重启后仍能找回进度。"
  },
  {
    title: "PostgreSQL",
    body: "生产环境用数据库共享推荐快照、任务状态、匿名偏好和学习进度，避免多实例各自保存一份本地文件而出现数据不一致。"
  },
  {
    title: "版本化缓存",
    body: "仓库输入、学习水平、目标、提示词或模型没有变化时直接复用已保存结果，避免重复调用 DeepSeek 和浪费 Token。"
  },
  {
    title: "匿名会话",
    body: "访客无需注册即可保存偏好、收藏和进度；服务端只使用 HttpOnly Cookie 派生的哈希身份，不接受浏览器自行指定用户 ID。"
  }
];

const verificationEvidence = [
  "TypeScript 类型检查无错误",
  "逻辑、安全与成本边界验证",
  "严格仓库卫生检查",
  "Next.js standalone 生产构建",
  "GitHub Actions + PostgreSQL 16 集成",
  "390 / 768 / 1440 浏览器布局与核心交互证据"
];

export function PortfolioOverview({
  dataSource = "seed",
  repositoryUrl,
  repositoryPublished = false
}: {
  dataSource?: "seed" | "github";
  repositoryUrl?: string;
  repositoryPublished?: boolean;
}) {
  const repositoryIsPublic = Boolean(repositoryUrl && repositoryPublished);
  const discoveryStep = dataSource === "github" ? "发现近期活跃仓库" : "加载内置演示仓库快照";

  return (
    <Panel className="mx-5 mt-5 overflow-hidden lg:mx-8">
      <div className="grid gap-6 bg-gradient-to-br from-white via-teal-50/40 to-sky-50/60 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:p-6">
        <div>
          <Badge tone="green">项目说明</Badge>
          <h2 id="portfolio-overview-title" className="mt-3 text-xl font-semibold tracking-tight text-slate-950">
            两分钟看懂 GitHub 学习雷达
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            GitHub 项目很多，但“为什么值得学、先复刻什么、每天具体做什么”通常需要自己重新整理。
            这个项目把公开仓库转成有依据、有范围、有验收标准和进度记录的学习任务。
          </p>

          <div className="mt-5 rounded-lg border border-teal-100 bg-white/85 p-4">
            <div className="flex items-center gap-2 text-teal-800">
              <CheckCircle2 size={17} aria-hidden="true" />
              <h3 className="text-sm font-semibold">所有人如何在两分钟内体验</h3>
            </div>
            <ol className="mt-3 grid gap-2 text-sm leading-6 text-slate-700">
              <li><strong>1. 看推荐：</strong>从当前{dataSource === "github" ? "今日" : "演示"}推荐中任选一个仓库，先看用途、推荐理由和 Mini 复刻重点。</li>
              <li><strong>2. 看拆解：</strong>进入项目详情，核对 README、工程信号、评分证据与学习边界。</li>
              <li><strong>3. 做任务：</strong>线上作品集版已内置完整方案；打开后完成一个步骤并刷新页面，确认匿名进度能够恢复。</li>
            </ol>
            <div className="mt-4 flex flex-wrap gap-3">
              <a href="#today-recommendations" className="focus-ring inline-flex items-center gap-1 rounded-md text-sm font-medium text-teal-700">
                开始两分钟体验 <ArrowRight size={14} aria-hidden="true" />
              </a>
              <Link href="/candidates" className="focus-ring inline-flex items-center gap-1 rounded-md text-sm font-medium text-slate-600">
                浏览全部候选
              </Link>
              <Link href="/history" className="focus-ring inline-flex items-center gap-1 rounded-md text-sm font-medium text-slate-600">
                查看运行证据
              </Link>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white/90 p-4 lg:p-5">
          <div className="flex items-center gap-2 text-slate-900">
            <Workflow size={17} className="text-teal-700" aria-hidden="true" />
            <h3 className="text-sm font-semibold">从发现仓库到形成学习任务</h3>
          </div>
          <ol className="mt-4 grid gap-2" aria-label="学习雷达处理流程">
            {[discoveryStep, ...journeySteps].map((step, index) => (
              <li key={step} className="flex items-start gap-3 text-sm leading-5 text-slate-700">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-50 text-xs font-semibold text-teal-700">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
            模型只负责分析、归纳和教学；抓取、评分、缓存、限流、任务恢复和数据隔离都由代码控制。
          </p>
        </div>
      </div>

      <details className="border-t border-slate-200 px-5 py-4 lg:px-6">
        <summary className="focus-ring cursor-pointer rounded-sm py-1 text-sm font-semibold text-slate-900">
          查看工程取舍、Token 防护、自部署与验证证据
        </summary>

        <div className="mt-5 grid gap-6 xl:grid-cols-2">
          <section aria-labelledby="engineering-choices-title">
            <div className="flex items-center gap-2">
              <ShieldCheck size={17} className="text-teal-700" aria-hidden="true" />
              <h3 id="engineering-choices-title" className="text-sm font-semibold text-slate-950">为什么这样设计</h3>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {engineeringChoices.map((choice) => (
                <div key={choice.title} className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                  <h4 className="text-sm font-semibold text-slate-900">{choice.title}</h4>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{choice.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="deployment-modes-title">
            <div className="flex items-center gap-2">
              <KeyRound size={17} className="text-teal-700" aria-hidden="true" />
              <h3 id="deployment-modes-title" className="text-sm font-semibold text-slate-950">如何防止公开访客消耗 DeepSeek Token</h3>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
                <h4 className="text-sm font-semibold text-emerald-900">线上作品集版（服务端成本边界已完成）</h4>
                <p className="mt-2 text-xs leading-5 text-emerald-800">
                  showcase 模式不注入 GitHub/DeepSeek Key，也不运行 Worker 或外部 Cron；生成、取消和刷新入口由服务端直接拒绝，并提供不调用模型的内置完整方案。
                </p>
              </div>
              <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-4">
                <h4 className="text-sm font-semibold text-sky-900">完整自部署版</h4>
                <p className="mt-2 text-xs leading-5 text-sky-800">
                  部署者运行 Web、Worker、PostgreSQL 和 Cron，并在自己的服务端 Secret 中配置 GitHub Token 与 DeepSeek Key，费用由部署者承担。
                </p>
              </div>
            </div>
          </section>

          <section aria-labelledby="open-source-title">
            <div className="flex items-center gap-2">
              <GitFork size={17} className="text-teal-700" aria-hidden="true" />
              <h3 id="open-source-title" className="text-sm font-semibold text-slate-950">开源后如何 Fork、配置自己的 Key 并部署</h3>
            </div>
            <ol className="mt-3 grid gap-2 text-xs leading-5 text-slate-600">
              <li><strong>1.</strong> 在 GitHub Fork 仓库，保留密钥为空的环境变量模板。</li>
              <li><strong>2.</strong> 在自己的托管平台 Secret 中配置数据库、GitHub Token、DeepSeek Key 和管理员密钥。</li>
              <li><strong>3.</strong> 执行迁移，分别部署 Web 与 Worker，再配置 Cron、HTTPS 域名、健康检查和备份。</li>
            </ol>
            <div className="mt-4">
              {repositoryIsPublic ? (
                <a
                  href={repositoryUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring inline-flex items-center gap-1 rounded-md text-sm font-medium text-teal-700"
                >
                  在 GitHub 查看开源仓库 <ExternalLink size={14} aria-hidden="true" />
                </a>
              ) : (
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <Badge tone="amber">开源准备中</Badge>
                  <span>
                    {repositoryUrl
                      ? "仓库地址已登记；切换为 Public 并通过公开门禁后，这里才会显示链接。"
                      : "仓库通过公开前安全门禁后，这里将展示真实 GitHub 地址。"}
                  </span>
                </div>
              )}
            </div>
          </section>

          <section aria-labelledby="verification-title">
            <div className="flex items-center gap-2">
              <Rocket size={17} className="text-teal-700" aria-hidden="true" />
              <h3 id="verification-title" className="text-sm font-semibold text-slate-950">已完成的测试、CI、数据库和浏览器证据</h3>
            </div>
            <ul className="mt-3 grid gap-2 text-xs leading-5 text-slate-600 sm:grid-cols-2">
              {verificationEvidence.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              正式发布前仍会补齐真实键盘、屏幕阅读器、断网恢复、独立双会话和云端回滚证据，不用构建结果冒充人工验收。
            </p>
          </section>
        </div>
      </details>
    </Panel>
  );
}

export function normalizePublicRepositoryUrl(value: string | undefined) {
  if (!value?.trim()) return undefined;

  try {
    const url = new URL(value.trim());
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      pathParts.length !== 2
    ) {
      return undefined;
    }
    return `https://github.com/${pathParts[0]}/${pathParts[1].replace(/\.git$/, "")}`;
  } catch {
    return undefined;
  }
}
