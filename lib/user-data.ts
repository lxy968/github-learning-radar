import {
  deleteAnonymousSession,
  deleteExpiredAnonymousSessions
} from "@/lib/anonymous-session-store";
import { deleteUserPreference } from "@/lib/preferences";
import { deleteUserState } from "@/lib/user-state";
import { deleteLearningProgress } from "@/lib/learning-progress";

export async function deleteAnonymousUserData(userId: string) {
  await deleteUserPreference(userId);
  await deleteUserState(userId);
  await deleteLearningProgress(userId);
  await deleteAnonymousSession(userId);
}

export async function cleanupExpiredAnonymousUserData(now = new Date(), batchSize = 1_000, maxBatches = 4) {
  const deletedUserIds: string[] = [];
  let storage: "postgres" | "local-json" = "local-json";
  let executedBatches = 0;
  const boundedMaxBatches = Math.max(1, Math.min(10, Math.trunc(maxBatches)));

  for (let batch = 0; batch < boundedMaxBatches; batch += 1) {
    const result = await deleteExpiredAnonymousSessions({
      now,
      limit: batchSize,
      beforeLocalDelete: async (userId) => {
        await deleteUserPreference(userId);
        await deleteUserState(userId);
        await deleteLearningProgress(userId);
      }
    });
    executedBatches += 1;
    storage = result.storage;
    deletedUserIds.push(...result.deletedUserIds);
    if (result.deletedUserIds.length < batchSize) break;
  }

  return { storage, deletedUserIds, batches: executedBatches };
}
