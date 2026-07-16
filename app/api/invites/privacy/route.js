import { NextResponse } from "next/server";

import { getDb } from "../../../../lib/firestore";
import { toInviteRequest } from "../../../../lib/invites";

const COLLECTION = "invite_requests";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function json(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...CORS_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const inviteToken = String(payload?.inviteToken ?? "").trim();

    if (!inviteToken) {
      return json({ ok: false, error: "inviteToken is required." }, { status: 400 });
    }

    const db = getDb();
    const docRef = db.collection(COLLECTION).doc(inviteToken);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      return json({ ok: false, error: "Invite not found." }, { status: 404 });
    }

    const acceptedAt = new Date();
    await docRef.set(
      {
        privacyPolicyAccepted: true,
        privacyPolicyAcceptedAt: acceptedAt,
        privacyAccepted: true,
        privacyAcceptedAt: acceptedAt,
      },
      { merge: true },
    );

    const refreshedSnapshot = await docRef.get();

    return json({
      ok: true,
      invite: toInviteRequest(refreshedSnapshot.id, refreshedSnapshot.data() ?? {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save privacy policy acceptance.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
