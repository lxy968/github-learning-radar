import { NextResponse } from "next/server";
import { listBookmarkedRecommendations } from "@/lib/user-state";
import { resolveAnonymousSession } from "@/lib/session-context";

export async function GET(request: Request) {
  const session = await resolveAnonymousSession(request);
  if (!session) return NextResponse.json({ error: "Anonymous session is required." }, { status: 401 });
  return NextResponse.json({
    bookmarks: await listBookmarkedRecommendations(session.userId)
  });
}
