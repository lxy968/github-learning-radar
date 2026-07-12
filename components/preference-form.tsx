"use client";

import { Check, Save } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Difficulty, RadarCategory, UserPreference } from "@/lib/types";

const interests: Array<{ value: RadarCategory; label: string }> = [
  { value: "ai-app", label: "AI 应用" },
  { value: "frontend", label: "前端" },
  { value: "backend", label: "后端" },
  { value: "devtool", label: "开发者工具" },
  { value: "database", label: "数据库" },
  { value: "automation", label: "自动化" },
  { value: "cli", label: "CLI" },
  { value: "fullstack", label: "全栈" }
];

const levels: Array<{ value: Difficulty; label: string }> = [
  { value: "beginner", label: "入门" },
  { value: "intermediate", label: "中级" },
  { value: "advanced", label: "进阶" }
];

const goals: Array<{ value: UserPreference["goal"]; label: string }> = [
  { value: "clone", label: "找项目复刻" },
  { value: "portfolio", label: "做作品集" },
  { value: "trend", label: "追踪趋势" },
  { value: "source-reading", label: "读源码" }
];

export function PreferenceForm({ initialPreference }: { initialPreference: UserPreference }) {
  const [preference, setPreference] = useState(initialPreference);
  const [languageInput, setLanguageInput] = useState(initialPreference.languages.join(", "));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const languagePreview = useMemo(
    () =>
      languageInput
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8),
    [languageInput]
  );

  function toggleInterest(value: RadarCategory) {
    const hasValue = preference.interests.includes(value);
    const nextInterests = hasValue
      ? preference.interests.filter((item) => item !== value)
      : [...preference.interests, value];

    if (nextInterests.length === 0) return;
    setPreference({ ...preference, interests: nextInterests });
  }

  async function savePreference() {
    const nextPreference = {
      ...preference,
      languages: languagePreview.length > 0 ? languagePreview : initialPreference.languages
    };
    setStatus("saving");

    try {
      const response = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextPreference)
      });

      if (!response.ok) throw new Error("Failed to save preferences");
      const data = (await response.json()) as { preference: UserPreference };
      setPreference(data.preference);
      setLanguageInput(data.preference.languages.join(", "));
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1400);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-950">兴趣方向</h2>
        <p className="mt-1 text-sm text-slate-600">这些方向会影响每日候选项目的排序和学习路线侧重点。</p>
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {interests.map((item) => {
            const active = preference.interests.includes(item.value);
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => toggleInterest(item.value)}
                className={cn(
                  "focus-ring h-10 rounded-md border px-3 text-sm font-medium transition",
                  active
                    ? "border-teal-700 bg-teal-50 text-teal-800"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-950">偏好语言</h2>
        <p className="mt-1 text-sm text-slate-600">用英文逗号分隔，最多保存 8 个。</p>
        <input
          value={languageInput}
          onChange={(event) => setLanguageInput(event.target.value)}
          className="focus-ring mt-4 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800"
          placeholder="TypeScript, Python, Go"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {languagePreview.map((language) => (
            <Badge key={language} tone="blue">
              {language}
            </Badge>
          ))}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-950">学习水平</h2>
          <div className="mt-4 grid grid-cols-3 rounded-md border border-slate-200 bg-slate-50 p-1">
            {levels.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setPreference({ ...preference, level: item.value })}
                className={cn(
                  "focus-ring h-9 rounded-md text-sm font-medium text-slate-600 transition",
                  preference.level === item.value && "bg-white text-teal-700 shadow-sm"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-950">学习目标</h2>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {goals.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setPreference({ ...preference, goal: item.value })}
                className={cn(
                  "focus-ring h-10 rounded-md border px-3 text-sm font-medium transition",
                  preference.goal === item.value
                    ? "border-teal-700 bg-teal-50 text-teal-800"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-sm text-slate-600">保存后，首页会按这组兴趣画像重新排序公共雷达推荐。</p>
        <Button variant={status === "error" ? "danger" : "primary"} onClick={savePreference} disabled={status === "saving"}>
          {status === "saved" ? <Check size={15} /> : <Save size={15} />}
          {status === "saving" ? "保存中" : status === "saved" ? "已保存" : status === "error" ? "保存失败" : "保存偏好"}
        </Button>
      </div>
    </div>
  );
}
