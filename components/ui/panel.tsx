import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={cn("rounded-lg border border-slate-200 bg-white", className)}>{children}</section>;
}
