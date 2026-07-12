import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  className,
  variant = "secondary",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  children: ReactNode;
}) {
  return (
    <button
      className={cn(
        "focus-ring inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition",
        variant === "primary" &&
          "border-teal-700 bg-teal-700 text-white hover:border-teal-800 hover:bg-teal-800",
        variant === "secondary" && "border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
        variant === "ghost" && "border-transparent bg-transparent text-slate-600 hover:bg-slate-100",
        variant === "danger" && "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
