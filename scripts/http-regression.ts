import assert from "node:assert/strict";

const baseUrl = (process.env.REGRESSION_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const expectedSiteUrl = process.env.REGRESSION_EXPECTED_SITE_URL?.replace(/\/$/, "");
const expectedDeploymentMode = process.env.REGRESSION_EXPECTED_DEPLOYMENT_MODE === "showcase" ? "showcase" : "full";

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const home = await get("/");
  assert.equal(home.response.status, 200);
  assert.match(home.cookie, /glr_session=v1\.[0-9a-z]{1,10}\.[A-Za-z0-9_-]{43}/);
  assert.match(home.cookie, /HttpOnly/i);
  assert.match(home.cookie, /SameSite=lax/i);
  assertContains(home.html, [
    "GitHub 学习雷达演示推荐",
    "当前是用于体验流程的内置种子快照，不代表当天热度",
    "aria-label=\"主导航\"",
    "aria-label=\"移动端主导航\"",
    "href=\"#main-content\"",
    "id=\"main-content\"",
    "今日推荐",
    "我的学习",
    "两分钟看懂 GitHub 学习雷达",
    "所有人如何在两分钟内体验",
    "从发现仓库到形成学习任务",
    "加载内置演示仓库快照",
    "如何防止公开访客消耗 DeepSeek Token",
    "开源后如何 Fork、配置自己的 Key 并部署",
    "已完成的测试、CI、数据库和浏览器证据",
    "为什么推荐",
    "Mini 复刻重点",
    "查看 README 摘录、完整推荐依据与评分",
    "README 清洗摘录",
    "雷达状态",
    "focus-ring",
    "min-h-16",
    "safe-area-inset-bottom"
  ]);
  if (expectedSiteUrl) {
    assert.ok(home.html.includes(expectedSiteUrl), "Home metadata should use the runtime SITE_URL.");
    for (const route of ["/sitemap.xml", "/robots.txt"]) {
      const metadataRoute = await get(route, home.cookiePair);
      assert.equal(metadataRoute.response.status, 200);
      assert.ok(metadataRoute.html.includes(expectedSiteUrl), `${route} should use the runtime SITE_URL.`);
    }
  }

  const renderedPages = new Map<string, string>();
  for (const route of ["/candidates", "/routes", "/bookmarks", "/history", "/settings"]) {
    const page = await get(route, home.cookiePair);
    assert.equal(page.response.status, 200, `${route} should return 200`);
    renderedPages.set(route, page.html);
  }
  assert.match(renderedPages.get("/bookmarks") ?? "", /还没有收藏项目/);
  assert.match(renderedPages.get("/routes") ?? "", /还没有收藏项目的学习路线/);
  assertContains(renderedPages.get("/candidates") ?? "", [
    "GitHub 候选项目演示快照",
    "不代表实时 GitHub discovery 结果",
    "内置演示候选快照",
    "action=\"/candidates\"",
    "name=\"q\"",
    "name=\"category\"",
    "name=\"sort\"",
    "筛选与排序在服务端执行",
    "aria-label=\"候选项目分页\""
  ]);
  const legacyLibrary = await get("/library", home.cookiePair);
  const serverRedirectedLibrary = legacyLibrary.response.status === 307 || legacyLibrary.response.status === 308;
  const renderedRedirectBoundary = legacyLibrary.response.status === 200 && legacyLibrary.html.includes("/candidates");
  assert.ok(serverRedirectedLibrary || renderedRedirectBoundary);
  if (serverRedirectedLibrary) assert.equal(legacyLibrary.response.headers.get("location"), "/candidates");

  const candidateHref = decodeHtml(
    (renderedPages.get("/candidates") ?? "").match(/href="(\/candidates\/[^\"?]+\/[^\"?]+)"/)?.[1] ?? ""
  );
  assert.ok(candidateHref, "Candidate pool should contain a candidate detail link.");
  const candidateDetail = await get(candidateHref, home.cookiePair);
  assert.equal(candidateDetail.response.status, 200);
  if (expectedDeploymentMode === "showcase") {
    assert.match(candidateDetail.html, /公开站只展示提前准备好的学习方案/);
    assert.equal(candidateDetail.html.includes("生成具体学习方案"), false);
    assert.equal(candidateDetail.html.includes("点击生成"), false);
  } else {
    assert.match(candidateDetail.html, /打开方案页不会调用模型/);
  }
  const candidateLearningHref = decodeHtml(
    candidateDetail.html.match(/href="(\/projects\/[^\"]+\/learning-plan)"/)?.[1] ?? ""
  );
  assert.ok(candidateLearningHref, "Candidate detail should contain a detailed learning plan entry.");
  const candidateLearning = await get(candidateLearningHref, home.cookiePair);
  assert.equal(candidateLearning.response.status, 200);
  assertContains(
    candidateLearning.html,
    expectedDeploymentMode === "showcase"
      ? ["选择一个学习周期", "DeepSeek 真实生成缓存", "可体验", "不会现场调用 DeepSeek", "总进度"]
      : ["选择一个学习周期", "3 天", "7 天", "14 天"]
  );
  const candidatePathParts = candidateLearningHref.split("/");
  const showcaseQueueBefore = expectedDeploymentMode === "showcase"
    ? await readQueueState(home.cookiePair)
    : null;
  const candidateJobResponse = await fetch(`${baseUrl}/api/study-plans`, {
    method: "POST",
    headers: {
      Cookie: home.cookiePair,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      owner: decodeURIComponent(candidatePathParts[2] ?? ""),
      repo: decodeURIComponent(candidatePathParts[3] ?? ""),
      duration: 3
    })
  });
  const candidateJobPayload = await candidateJobResponse.json() as { status?: string; queued?: boolean };
  if (expectedDeploymentMode === "showcase") {
    assert.equal(candidateJobResponse.status, 403);
    assert.equal((candidateJobPayload as { code?: string }).code, "showcase_read_only");

    const owner = decodeURIComponent(candidatePathParts[2] ?? "");
    const repo = decodeURIComponent(candidatePathParts[3] ?? "");
    const firstPlansResponse = await fetch(
      `${baseUrl}/api/study-plans?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`,
      { headers: { Cookie: home.cookiePair }, cache: "no-store" }
    );
    assert.equal(firstPlansResponse.status, 200);
    const firstPlansPayload = await firstPlansResponse.json() as {
      status?: string;
      job?: unknown;
      plans?: Array<{
        id: string;
        duration: number;
        generationStatus?: string;
        providerAttempts?: unknown[];
        days: Array<{ steps: Array<{ id: string }> }>;
      }>;
    };
    const showcasePlan = firstPlansPayload.plans?.find((plan) => plan.duration === 3);
    assert.equal(firstPlansPayload.status, "success");
    assert.equal(firstPlansPayload.job, null);
    assert.equal(showcasePlan?.id, "showcase-hermes-agent-3-v1");
    assert.equal(showcasePlan?.generationStatus, "complete");
    assert.equal(showcasePlan?.days.length, 3);
    assert.equal(showcasePlan?.providerAttempts?.length, 0);

    const stepId = showcasePlan?.days[0]?.steps[0]?.id ?? "";
    assert.ok(stepId, "Showcase plan should expose a first step.");
    const progressPlanId = `detailed:${showcasePlan!.id}`;
    const progressUpdate = await fetch(`${baseUrl}/api/progress`, {
      method: "PUT",
      headers: {
        Cookie: home.cookiePair,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        planId: progressPlanId,
        updates: [{ stepId, completed: true, updatedAt: "2026-07-14T08:00:00.000Z" }]
      })
    });
    assert.equal(progressUpdate.status, 200);

    const repeatedPlansResponse = await fetch(
      `${baseUrl}/api/study-plans?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`,
      { headers: { Cookie: home.cookiePair }, cache: "no-store" }
    );
    const repeatedPlansPayload = await repeatedPlansResponse.json() as typeof firstPlansPayload;
    assert.equal(repeatedPlansPayload.plans?.find((plan) => plan.duration === 3)?.id, showcasePlan?.id);

    const restoredProgress = await fetch(
      `${baseUrl}/api/progress?planId=${encodeURIComponent(progressPlanId)}`,
      { headers: { Cookie: home.cookiePair }, cache: "no-store" }
    );
    assert.equal(restoredProgress.status, 200);
    const restoredPayload = await restoredProgress.json() as {
      entries?: Array<{ stepId?: string; completed?: boolean }>;
    };
    assert.ok(restoredPayload.entries?.some((entry) => entry.stepId === stepId && entry.completed === true));

    const showcaseQueueAfter = await readQueueState(home.cookiePair);
    assert.deepEqual(showcaseQueueAfter, showcaseQueueBefore);
  } else {
    assert.equal(candidateJobResponse.status, 202);
    assert.equal(candidateJobPayload.status, "success");
    assert.equal(candidateJobPayload.queued, true);
  }

  const emptyCandidates = await get(
    "/candidates?q=__http_regression_no_such_repository__&sort=name&page=999",
    home.cookiePair
  );
  assert.equal(emptyCandidates.response.status, 200);
  assert.match(emptyCandidates.html, /没有符合当前搜索条件的候选项目/);

  const projectHref = decodeHtml(home.html.match(/href="(\/projects\/[^"?]+)"/)?.[1] ?? "");
  assert.ok(projectHref, "Home page should contain a project link.");
  const project = await get(projectHref, home.cookiePair);
  assert.equal(project.response.status, 200);
  if (expectedDeploymentMode === "showcase") {
    assert.match(project.html, /查看预置学习方案/);
    assert.equal(project.html.includes("生成具体学习方案"), false);
  }

  const learningHref = decodeHtml(project.html.match(/href="(\/projects\/[^\"]+\/learning-plan)"/)?.[1] ?? "");
  assert.ok(learningHref, "Project page should contain a detailed learning plan link.");
  const learning = await get(learningHref, home.cookiePair);
  assert.equal(learning.response.status, 200);
  if (expectedDeploymentMode === "showcase") {
    assertContains(learning.html, [
      "作品集预置体验",
      "DeepSeek 真实生成缓存",
      "可体验",
      "不会现场调用 DeepSeek",
      "总进度"
    ]);
    assert.equal(learning.html.includes("开始后台生成"), false);
    assert.equal(learning.html.includes("未生成"), false);

    const refreshResponse = await fetch(`${baseUrl}/api/radar/refresh`, { method: "POST" });
    assert.equal(refreshResponse.status, 403);
    assert.equal((await refreshResponse.json() as { code?: string }).code, "showcase_read_only");
    const cronResponse = await fetch(`${baseUrl}/api/cron/daily-radar?force=1`);
    assert.equal(cronResponse.status, 403);
    assert.equal((await cronResponse.json() as { code?: string }).code, "showcase_read_only");
  } else {
    assertContains(learning.html, ["一次生成完整方案", "同一时间只运行一个后台任务", "开始后台生成", "3 天", "7 天", "14 天"]);

    const forcedResponse = await fetch(`${baseUrl}/api/study-plans`, {
      method: "POST",
      headers: {
        Cookie: home.cookiePair,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        owner: decodeURIComponent(candidatePathParts[2] ?? ""),
        repo: decodeURIComponent(candidatePathParts[3] ?? ""),
        duration: 3,
        force: true
      })
    });
    assert.equal(forcedResponse.status, 401);
    assert.equal((await forcedResponse.json() as { code?: string }).code, "forced_generation_forbidden");
  }
  assert.equal(
    /DeepSeek Flash|DeepSeek Pro|deepseek-v4/i.test(
      home.html + project.html + learning.html + candidateDetail.html + candidateLearning.html + [...renderedPages.values()].join("")
    ),
    false
  );
  if (learning.html.includes("总进度")) {
    assertContains(learning.html, [
      "当前任务",
      "完成并进入下一步",
      "role=\"progressbar\"",
      "aria-expanded=\"true\"",
      "缓存依据",
      "h-11 w-11",
      "aria-label=\"学习方案总进度\"",
      "标记完成"
    ]);
    assert.equal((learning.html.match(/aria-expanded="true"/g) ?? []).length, 1);
  }

  const missing = await get("/this-route-must-not-exist", home.cookiePair);
  assert.equal(missing.response.status, 404);
  assert.match(missing.html, /没有找到这个项目或页面/);

  const health = await get("/api/health", home.cookiePair);
  assert.ok(health.response.status === 200 || health.response.status === 503);
  const healthPayload = JSON.parse(health.html) as { status?: string; storage?: string; taskQueue?: unknown; studyPlanQueue?: unknown };
  assert.ok(healthPayload.status === "ok" || healthPayload.status === "degraded");
  assert.ok(healthPayload.taskQueue);
  assert.ok(healthPayload.studyPlanQueue);
  if (health.response.status === 503) {
    assert.equal(healthPayload.status, "degraded");
    assert.equal(healthPayload.storage, "local-json");
  }

  console.log(`HTTP regression passed against ${baseUrl}`);
}

async function get(pathname: string, cookiePair = "") {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: cookiePair ? { Cookie: cookiePair } : undefined,
    redirect: "manual"
  });
  const html = await response.text();
  const cookie = response.headers.get("set-cookie") ?? "";
  return {
    response,
    html,
    cookie,
    cookiePair: cookie.split(";", 1)[0] ?? cookiePair
  };
}

async function readQueueState(cookiePair: string) {
  const health = await get("/api/health", cookiePair);
  const payload = JSON.parse(health.html) as {
    taskQueue?: { queued?: number; running?: number; staleRunning?: number };
    studyPlanQueue?: { queued?: number; running?: number; staleRunning?: number };
  };
  return {
    taskQueue: payload.taskQueue,
    studyPlanQueue: payload.studyPlanQueue
  };
}

function assertContains(value: string, markers: string[]) {
  for (const marker of markers) assert.ok(value.includes(marker), `Missing rendered marker: ${marker}`);
}

function decodeHtml(value: string) {
  return value.replaceAll("&amp;", "&").replaceAll("&#x2F;", "/");
}
