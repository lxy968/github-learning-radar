import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <div className="animate-pulse px-5 py-6 lg:px-8">
        <div className="h-4 w-32 rounded bg-slate-200" />
        <div className="mt-4 h-8 w-72 max-w-full rounded bg-slate-200" />
        <div className="mt-3 h-4 w-[520px] max-w-full rounded bg-slate-100" />
        <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="grid gap-4">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-64 rounded-lg border border-slate-200 bg-white" />
            ))}
          </div>
          <div className="h-72 rounded-lg border border-slate-200 bg-white" />
        </div>
      </div>
    </AppShell>
  );
}
