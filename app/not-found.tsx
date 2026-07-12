import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/ui/panel";

export default function NotFound() {
  return (
    <AppShell>
      <div className="px-5 py-10 lg:px-8">
        <Panel className="mx-auto max-w-2xl p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-slate-100 text-slate-600">
            <SearchX size={21} />
          </div>
          <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-teal-700">404</div>
          <h1 className="mt-2 text-lg font-semibold text-slate-950">没有找到这个项目或页面</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">它可能已离开当前雷达，或者链接已经失效。</p>
          <Link
            href="/"
            className="focus-ring mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-teal-700 bg-teal-700 px-3 text-sm font-medium text-white hover:bg-teal-800"
          >
            <ArrowLeft size={15} />
            返回今日雷达
          </Link>
        </Panel>
      </div>
    </AppShell>
  );
}
