"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AppShell>
      <div className="px-5 py-10 lg:px-8">
        <Panel className="mx-auto max-w-2xl p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-red-50 text-red-700">
            <AlertTriangle size={21} />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-slate-950">页面暂时无法加载</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            GitHub、数据库或 AI 服务可能暂时不可用。你的本地学习进度不会因为这个错误被清空。
          </p>
          <Button className="mt-5" variant="primary" onClick={reset}>
            <RotateCcw size={15} />
            重新尝试
          </Button>
        </Panel>
      </div>
    </AppShell>
  );
}
