import { NextResponse } from "next/server";

import { getDb } from "../../../../lib/firestore";
import { toInviteRequest } from "../../../../lib/invites";

const COLLECTION = "invite_requests";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
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
  const inviteSnapshot = await db.collection(COLLECTION).doc(rawInviteToken).get();

  if (!inviteSnapshot.exists) {
    return json({ ok: false, error: "Invite not found." }, { status: 404 });
  }

  const snapshot = await db.collection(COLLECTION).get();
  const participants = snapshot.docs
    .map((doc) => toInviteRequest(doc.id, doc.data() ?? {}))
    .filter((invite) => String(invite.status ?? "").trim().toLowerCase() === "confirmed")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((invite) => ({
      id: invite.id,
      firstName: String(invite.firstName ?? "").trim(),
      profilePhotoUrl: String(invite.profilePhotoUrl ?? "").trim(),
    }));

  return json({
    ok: true,
    participants,
  });
}
