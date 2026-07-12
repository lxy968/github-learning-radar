import { deleteAnonymousSession } from "@/lib/anonymous-session-store";
import { deleteUserPreference } from "@/lib/preferences";
import { deleteUserState } from "@/lib/user-state";
import { deleteLearningProgress } from "@/lib/learning-progress";

export async function deleteAnonymousUserData(userId: string) {
  await deleteUserPreference(userId);
  await deleteUserState(userId);
  await deleteLearningProgress(userId);
  await deleteAnonymousSession(userId);
}
