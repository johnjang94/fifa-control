import { NextResponse } from "next/server";

import { getDb } from "../../../../lib/firestore";
import { toInviteRequest } from "../../../../lib/invites";
import { createSupportAccessToken } from "../../../../lib/support-access";

const COLLECTION = "invite_requests";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-support-access-token",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
};

function json(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...CORS_HEADERS, ...(init?.headers ?? {}) },
  });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request) {
  const rawInviteToken = String(request.nextUrl.searchParams.get("inviteToken") ?? "").trim();

  if (!rawInviteToken) {
    return json({ ok: false, error: "inviteToken is required." }, { status: 400 });
  }

  const db = getDb();
  const directSnapshot = await db.collection(COLLECTION).doc(rawInviteToken).get();
  const snapshot = directSnapshot.exists ? directSnapshot : null;

  if (!snapshot) {
    return json({ ok: true, invite: null });
  }

  const invite = toInviteRequest(snapshot.id, snapshot.data() ?? {});

  return json({
    ok: true,
    invite,
    supportAccessToken: createSupportAccessToken(invite),
  });
}
