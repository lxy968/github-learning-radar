"use client";

import { useEffect, useState } from "react";
import { Bookmark, Check, ThumbsDown, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FeedbackEventType, RepoInteraction } from "@/lib/types";

type FeedbackState = {
  wantToLearn: boolean;
  bookmarked: boolean;
  skipped: boolean;
  pendingEvent: FeedbackEventType | null;
};

const emptyState: FeedbackState = {
  wantToLearn: false,
  bookmarked: false,
  skipped: false,
  pendingEvent: null
};

export function FeedbackControls({ repoId }: { repoId: number }) {
  const storageKey = `learning-radar:${repoId}`;
  const [state, setState] = useState<FeedbackState>(emptyState);

  useEffect(() => {
    let ignore = false;

    async function loadInteraction() {
      try {
        const response = await fetch(`/api/feedback?repoId=${repoId}`);
        if (!response.ok) throw new Error("Failed to load feedback");
        const data = (await response.json()) as { interaction: RepoInteraction };
        if (ignore) return;
        const next = mapInteraction(data.interaction);
        setState(next);
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        const raw = window.localStorage.getItem(storageKey);
        if (raw && !ignore) setState({ ...emptyState, ...(JSON.parse(raw) as FeedbackState) });
      }
    }

    loadInteraction();

    return () => {
      ignore = true;
    };
  }, [repoId, storageKey]);

  async function update(eventType: FeedbackEventType, next: Partial<FeedbackState>, value: boolean) {
    const optimistic = { ...state, ...next, pendingEvent: eventType };
    setState(optimistic);
    window.localStorage.setItem(storageKey, JSON.stringify(optimistic));

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId, eventType, value })
      });

      if (!response.ok) throw new Error("Failed to save feedback");
      const data = (await response.json()) as { interaction: RepoInteraction };
      const saved = mapInteraction(data.interaction);
      setState(saved);
      window.localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      setState({ ...optimistic, pendingEvent: null });
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={state.wantToLearn ? "primary" : "secondary"}
        disabled={state.pendingEvent !== null}
        onClick={() => update("want_to_learn", { wantToLearn: !state.wantToLearn, skipped: false }, !state.wantToLearn)}
      >
        {state.wantToLearn ? <Check size={15} /> : <Zap size={15} />}
        想学
      </Button>
      <Button
        variant={state.bookmarked ? "primary" : "secondary"}
        disabled={state.pendingEvent !== null}
        onClick={() => update("bookmarked", { bookmarked: !state.bookmarked }, !state.bookmarked)}
      >
        <Bookmark size={15} />
        收藏
      </Button>
      <Button
        variant={state.skipped ? "danger" : "ghost"}
        disabled={state.pendingEvent !== null}
        onClick={() => update("skipped", { skipped: !state.skipped, wantToLearn: false }, !state.skipped)}
      >
        <ThumbsDown size={15} />
        跳过
      </Button>
    </div>
  );
}

function mapInteraction(interaction: RepoInteraction): FeedbackState {
  return {
    wantToLearn: interaction.wantToLearn,
    bookmarked: interaction.bookmarked,
    skipped: interaction.skipped,
    pendingEvent: null
  };
}
