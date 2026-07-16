import type { ReactNode } from "react";
import { MobileExploreNav, SidebarNav } from "@/components/sidebar-nav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen lg:pl-[248px]">
      <a
        href="#main-content"
        className="focus-ring sr-only z-50 rounded-md bg-white px-4 py-2 text-sm font-medium text-teal-700 shadow focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        跳到主要内容
      </a>
      <aside className="sticky top-0 z-30 border-r border-slate-200 bg-white lg:fixed lg:inset-y-0 lg:left-0 lg:w-[248px]">
        <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-4 lg:px-5">
          <div aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-700 text-sm font-semibold text-white">
            学
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-950">GitHub 学习雷达</div>
            <div className="hidden text-xs text-slate-500 sm:block">每日开源项目学习路线</div>
          </div>
          <MobileExploreNav />
        </div>
        <SidebarNav />
      </aside>
      <main
        id="main-content"
        tabIndex={-1}
        className="min-w-0 pb-[calc(4rem+env(safe-area-inset-bottom))] focus:outline-none lg:pb-0"
      >
        {children}
      </main>
    </div>
  );
}
