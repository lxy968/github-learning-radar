export type JobQueueHealthSnapshot = {
  queued: number;
  readyQueued?: number;
  running: number;
  staleRunning: number;
  oldestQueuedAt: string | null;
};

export function getJobQueueDegradationReasons(
  queueName: string,
  queue: JobQueueHealthSnapshot,
  now: Date,
  options: { maxReadyQueued: number; maxReadyWaitMs: number }
) {
  const reasons: string[] = [];
  const safeQueueName = queueName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_") || "job";
  const readyQueued = queue.readyQueued ?? queue.queued;

  if (queue.staleRunning > 0) reasons.push(`${safeQueueName}_stale_running`);
  if (readyQueued >= Math.max(1, Math.round(options.maxReadyQueued))) {
    reasons.push(`${safeQueueName}_ready_backlog`);
  }

  if (queue.oldestQueuedAt) {
    const oldestReadyAt = new Date(queue.oldestQueuedAt).getTime();
    if (
      Number.isFinite(oldestReadyAt) &&
      now.getTime() - oldestReadyAt >= Math.max(1_000, Math.round(options.maxReadyWaitMs))
    ) {
      reasons.push(`${safeQueueName}_oldest_ready_exceeded`);
    }
  }

  return reasons;
}
