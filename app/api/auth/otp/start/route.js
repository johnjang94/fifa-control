import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { toInviteRequest } from "../../../../../lib/invites";
import { buildOtpMessage, createOtpChallenge, OTP_COLLECTION } from "../../../../../lib/login-otp";
import { sendTextSms } from "../../../../../lib/sms";

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

    if (phoneNumber.length !== 10) {
      return json({ ok: false, error: "Please enter a valid 10-digit phone number." }, { status: 400 });
    }

    const db = getDb();
    const snapshot = await db
      .collection(COLLECTION)
      .where("phoneNumber", "==", phoneNumber)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return json({
        ok: true,
        delivered: false,
        message: "If this phone number is registered, a verification code has been sent.",
      });
    }

    const invite = toInviteRequest(snapshot.docs[0].id, snapshot.docs[0].data() ?? {});
    const challenge = await createOtpChallenge(db, invite);
    const result = await sendTextSms({
      to: challenge.phoneNumber,
      message: buildOtpMessage(invite.firstName, challenge.code),
    });

    if (!result.ok) {
      await db.collection(OTP_COLLECTION).doc(challenge.phoneNumber).delete().catch(() => {});
      return json(
        {
          ok: false,
          error: result.skipped
            ? "SMS is not configured on this server."
            : result.error ?? "Unable to send verification code.",
        },
        { status: 503 },
      );
    }

    return json({
      ok: true,
      delivered: true,
      message: "Verification code sent.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send verification code.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
