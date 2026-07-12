import { Badge } from "@/components/ui/badge";
import type { RepoSignalState } from "@/lib/types";

export function RepositorySignalBadge({ label, state }: { label: string; state: RepoSignalState }) {
  return (
    <Badge tone={state === "present" ? "green" : state === "unknown" ? "blue" : "neutral"}>
      {label} · {state === "present" ? "有" : state === "absent" ? "无" : "未知"}
    </Badge>
  );
}
