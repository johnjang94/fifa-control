import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { toInviteRequest } from "../../../../../lib/invites";
import { createSupportAccessToken } from "../../../../../lib/support-access";
import { verifyOtpChallenge } from "../../../../../lib/login-otp";

const COLLECTION = "invite_requests";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
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

export async function POST(request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const phoneNumber = String(payload?.phoneNumber ?? "").replace(/\D/g, "");
    const code = String(payload?.code ?? "").replace(/\D/g, "");

    if (phoneNumber.length !== 10) {
      return json({ ok: false, error: "Please enter a valid phone number." }, { status: 400 });
    }

    if (code.length !== 6) {
      return json({ ok: false, error: "Please enter the 6-digit code." }, { status: 400 });
    }

    const db = getDb();
    const verified = await verifyOtpChallenge(db, phoneNumber, code);

    if (!verified.ok) {
      return json({ ok: false, error: verified.error ?? "Invalid verification code." }, { status: 401 });
    }

    const inviteSnapshot = await db.collection(COLLECTION).doc(verified.inviteId).get();
    if (!inviteSnapshot.exists) {
      return json({ ok: false, error: "Invite not found." }, { status: 404 });
    }

    const invite = toInviteRequest(inviteSnapshot.id, inviteSnapshot.data() ?? {});

    return json({
      ok: true,
      inviteToken: invite.id,
      supportAccessToken: createSupportAccessToken(invite),
      invite,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify code.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
