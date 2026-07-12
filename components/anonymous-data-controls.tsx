"use client";

import { ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const localDataPrefixes = ["learning-radar:", "learning-plan:", "detailed-study-plan:"];

export function AnonymousDataControls() {
  const [status, setStatus] = useState<"idle" | "deleting" | "error">("idle");

  async function deleteData() {
    if (!window.confirm("确定清除当前浏览器会话保存的偏好、收藏、反馈和学习进度吗？此操作无法撤销。")) return;
    setStatus("deleting");
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error("delete failed");
      clearLocalLearningData();
      window.location.assign("/settings");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700">
          <ShieldCheck size={18} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-950">匿名会话与隐私</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            本站使用不可读的 HttpOnly 随机 Cookie 区分匿名访客，服务端只保存令牌哈希，不保存你的姓名或邮箱。
            当前浏览器的偏好、收藏和反馈不会与其他浏览器共享；清除浏览器 Cookie 后将无法找回这组匿名数据。
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            具体学习步骤会同步到该匿名会话，同时保留本机离线副本。你可以随时清除服务端数据和本机进度。
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <span className={status === "error" ? "text-sm text-red-700" : "text-sm text-slate-500"}>
          {status === "error" ? "清除失败，请稍后重试。" : "清除后会立即创建一组全新的匿名会话。"}
        </span>
        <Button variant="danger" onClick={deleteData} disabled={status === "deleting"}>
          <Trash2 size={15} />
          {status === "deleting" ? "正在清除" : "清除我的数据"}
        </Button>
      </div>
    </section>
  );
}

function clearLocalLearningData() {
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter(
      (key): key is string => Boolean(key)
    );
    for (const key of keys) {
      if (localDataPrefixes.some((prefix) => key.startsWith(prefix))) window.localStorage.removeItem(key);
    }
  } catch {
    // Server-side deletion already succeeded; unavailable browser storage needs no further action.
  }
}
