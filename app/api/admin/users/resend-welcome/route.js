import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { buildWelcomeSmsMessage, toInviteRequest } from "../../../../../lib/invites";
import { sendTextSms } from "../../../../../lib/sms";

const COLLECTION = "invite_requests";
const WELCOME_SMS_DELIVERY_STATUS = {
  SENT: "sent",
  FAILED: "failed",
  SKIPPED: "skipped",
};
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-key",
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

function adminKeyMatches(request) {
  const expected = process.env.ADMIN_ACCESS_KEY;
  if (!expected) {
    return true;
  }

  const provided = request.headers.get("x-admin-key") ?? "";
  return provided === expected;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request) {
  if (!adminKeyMatches(request)) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

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
      return json({ ok: false, error: "User not found." }, { status: 404 });
    }

    const wasResent = Boolean(snapshot.data()?.welcomeSmsSentAt);
    const invite = toInviteRequest(snapshot.id, snapshot.data() ?? {});
    const phoneNumber = String(invite.phoneNumber ?? "").replace(/\D/g, "");
    const firstName = String(invite.firstName ?? "").trim();

    if (!phoneNumber || !firstName) {
      return json({ ok: false, error: "Invite is missing contact information." }, { status: 400 });
    }

    const message = buildWelcomeSmsMessage(firstName);
    const result = await sendTextSms({ to: phoneNumber, message });
    const deliveryStatus = result.ok
      ? WELCOME_SMS_DELIVERY_STATUS.SENT
      : result.skipped
        ? WELCOME_SMS_DELIVERY_STATUS.SKIPPED
        : WELCOME_SMS_DELIVERY_STATUS.FAILED;
    const errorMessage = result.ok
      ? null
      : result.error ?? (result.skipped ? "SMS send was skipped because Twilio is not configured." : "Failed to send welcome text.");

    const previousSentAt = snapshot.data()?.welcomeSmsSentAt ?? null;
    const previousResendCount = Number(snapshot.data()?.welcomeSmsResendCount ?? 0);

    await docRef.set(
      {
        welcomeSmsAttemptedAt: new Date(),
        welcomeSmsDeliveryStatus: deliveryStatus,
        welcomeSmsErrorMessage: errorMessage,
        welcomeSmsSentAt: previousSentAt ?? (result.ok ? new Date() : null),
        welcomeSmsMessage: message,
        welcomeSmsSid: result.sid ?? null,
        welcomeSmsResentAt: result.ok ? new Date() : null,
        welcomeSmsResendCount: result.ok ? previousResendCount + 1 : previousResendCount,
      },
      { merge: true },
    );

    if (!result.ok) {
      return json(
        {
          ok: false,
          error: errorMessage ?? "Failed to send welcome text.",
          deliveryStatus,
        },
        { status: result.skipped ? 503 : 502 },
      );
    }

    const refreshedSnapshot = await docRef.get();
    return json({
      ok: true,
      resent: true,
      wasResent,
      deliveryStatus,
      user: toInviteRequest(refreshedSnapshot.id, refreshedSnapshot.data() ?? {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resend welcome text.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
