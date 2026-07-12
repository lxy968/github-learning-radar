import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-slate-200 bg-white px-5 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-8">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-teal-700">{eyebrow}</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
