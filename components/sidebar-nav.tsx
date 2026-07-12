"use client";

import Link from "next/link";
import {
  CalendarDays,
  Compass,
  FolderSearch2,
  Heart,
  Library,
  Settings,
  Sparkles
} from "lucide-react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const primaryNavItems = [
  { href: "/", label: "今日推荐", icon: Sparkles, matches: ["/"] },
  { href: "/routes", label: "我的学习", icon: FolderSearch2, matches: ["/routes", "/projects"] },
  { href: "/bookmarks", label: "收藏", icon: Heart, matches: ["/bookmarks"] },
  { href: "/settings", label: "设置", icon: Settings, matches: ["/settings"] }
] as const;

export const exploreNavItems = [
  { href: "/candidates", label: "候选项目", icon: Compass, matches: ["/candidates"] },
  { href: "/library", label: "项目库", icon: Library, matches: ["/library"] },
  { href: "/history", label: "运行历史", icon: CalendarDays, matches: ["/history"] }
] as const;

type NavItem = (typeof primaryNavItems)[number] | (typeof exploreNavItems)[number];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <>
      <nav aria-label="主导航" className="hidden p-3 lg:block">
        <div className="space-y-1">
          {primaryNavItems.map((item) => (
            <DesktopNavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </div>
        <div className="mx-3 mb-2 mt-6 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          探索
        </div>
        <div className="space-y-1">
          {exploreNavItems.map((item) => (
            <DesktopNavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </div>
      </nav>

      <nav
        aria-label="移动端主导航"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-slate-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur lg:hidden"
      >
        {primaryNavItems.map((item) => {
          const active = isNavItemActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "focus-ring flex min-h-16 flex-col items-center justify-center gap-1 rounded-md px-1 text-[11px] font-medium transition",
                active ? "text-teal-700" : "text-slate-500 hover:text-slate-800"
              )}
            >
              <item.icon size={19} strokeWidth={active ? 2.4 : 2} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export function MobileExploreNav() {
  const pathname = usePathname();
  const active = exploreNavItems.some((item) => isNavItemActive(pathname, item));

  return (
    <details className="relative ml-auto lg:hidden">
      <summary
        className={cn(
          "focus-ring flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-md px-3 text-sm font-medium [&::-webkit-details-marker]:hidden",
          active ? "bg-teal-50 text-teal-800" : "text-slate-600 hover:bg-slate-100"
        )}
      >
        <Compass size={16} /> 探索
      </summary>
      <div className="absolute right-0 top-12 z-50 w-44 rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
        {exploreNavItems.map((item) => {
          const itemActive = isNavItemActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={itemActive ? "page" : undefined}
              className={cn(
                "focus-ring flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium",
                itemActive ? "bg-teal-50 text-teal-800" : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <item.icon size={16} /> {item.label}
            </Link>
          );
        })}
      </div>
    </details>
  );
}

export function isNavItemActive(pathname: string, item: Pick<NavItem, "matches">) {
  return item.matches.some((prefix) =>
    prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function DesktopNavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isNavItemActive(pathname, item);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-ring flex min-h-10 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition",
        active
          ? "bg-teal-50 text-teal-800 shadow-sm ring-1 ring-inset ring-teal-100"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
      )}
    >
      <item.icon size={17} />
      {item.label}
    </Link>
  );
}
