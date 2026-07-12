"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LearningProgressEntry } from "@/lib/learning-progress";

type SyncState = "loading" | "synced" | "offline";

export function useSyncedProgress(input: { planId: string; storageKey: string; stepIds: string[] }) {
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const completedRef = useRef<Record<string, boolean>>({});
  const timestampsRef = useRef<Record<string, string>>({});
  const stepIdsKey = input.stepIds.join("\u001f");

  const syncFromServer = useCallback(async () => {
    const stepIds = stepIdsKey ? stepIdsKey.split("\u001f") : [];
    const result = await synchronizeProgress({ ...input, stepIds });
    timestampsRef.current = result.timestamps;
    completedRef.current = result.completed;
    setCompleted(result.completed);
    setSyncState(result.syncState);
  }, [input.planId, input.storageKey, stepIdsKey]);

  useEffect(() => {
    void syncFromServer();
    const handleOnline = () => void syncFromServer();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [syncFromServer]);

  const toggleStep = useCallback(
    (stepId: string) => {
      const updatedAt = new Date().toISOString();
      const next = { ...completedRef.current, [stepId]: !completedRef.current[stepId] };
      const timestamps = { ...timestampsRef.current, [stepId]: updatedAt };
      completedRef.current = next;
      timestampsRef.current = timestamps;
      setCompleted(next);
      persistLocal(input.storageKey, next, timestamps);
      void writeRemote(input.planId, [{ stepId, completed: next[stepId], updatedAt }])
        .then(() => setSyncState("synced"))
        .catch(() => setSyncState("offline"));
    },
    [input.planId, input.storageKey]
  );

  return { completed, toggleStep, syncState, syncNow: syncFromServer };
}

export async function synchronizeProgress(input: { planId: string; storageKey: string; stepIds: string[] }) {
  const local = readBooleanMap(input.storageKey);
  const localTimestamps = readTimestampMap(`${input.storageKey}:meta`);
  try {
    const response = await fetch(`/api/progress?planId=${encodeURIComponent(input.planId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("progress unavailable");
    const data = (await response.json()) as { entries?: LearningProgressEntry[] };
    const remote = new Map((data.entries ?? []).map((entry) => [entry.stepId, entry]));
    const merged = { ...local };
    const timestamps = { ...localTimestamps };
    const upload: LearningProgressEntry[] = [];

    for (const stepId of input.stepIds) {
      const remoteEntry = remote.get(stepId);
      const hasLocalValue = Object.prototype.hasOwnProperty.call(local, stepId);
      const localUpdatedAt = localTimestamps[stepId];
      if (remoteEntry && (!hasLocalValue || !localUpdatedAt || remoteEntry.updatedAt >= localUpdatedAt)) {
        merged[stepId] = remoteEntry.completed;
        timestamps[stepId] = remoteEntry.updatedAt;
      } else if (hasLocalValue) {
        const updatedAt = localUpdatedAt ?? new Date().toISOString();
        timestamps[stepId] = updatedAt;
        upload.push({ stepId, completed: Boolean(local[stepId]), updatedAt });
      }
    }
    persistLocal(input.storageKey, merged, timestamps);
    if (upload.length > 0) await writeRemote(input.planId, upload);
    return { completed: merged, timestamps, syncState: "synced" as const };
  } catch {
    return { completed: local, timestamps: localTimestamps, syncState: "offline" as const };
  }
}

async function writeRemote(planId: string, updates: LearningProgressEntry[]) {
  const response = await fetch("/api/progress", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId, updates })
  });
  if (!response.ok) throw new Error("progress update failed");
}

function readBooleanMap(storageKey: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).map(([key, completed]) => [key, completed === true]));
  } catch {
    return {};
  }
}

function readTimestampMap(storageKey: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  } catch {
    return {};
  }
}

function persistLocal(storageKey: string, completed: Record<string, boolean>, timestamps: Record<string, string>) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(completed));
    window.localStorage.setItem(`${storageKey}:meta`, JSON.stringify(timestamps));
  } catch {
    // Server synchronization can still succeed when local storage is unavailable.
  }
}
