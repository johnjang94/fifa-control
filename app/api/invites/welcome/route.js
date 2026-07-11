import { NextResponse } from "next/server";

import { getDb } from "../../../../lib/firestore";
import { sendTextSms } from "../../../../lib/sms";
import { toInviteRequest } from "../../../../lib/invites";

const COLLECTION = "invite_requests";
const WELCOME_SMS_DELIVERY_STATUS = {
  SENT: "sent",
  FAILED: "failed",
  SKIPPED: "skipped",
};
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

    const invite = toInviteRequest(snapshot.id, snapshot.data() ?? {});
    const phoneNumber = String(invite.phoneNumber ?? "").replace(/\D/g, "");
    const firstName = String(invite.firstName ?? "").trim();
    const sentAt = snapshot.data()?.welcomeSmsSentAt ?? null;

    if (!phoneNumber || !firstName) {
      return json({ ok: false, error: "Invite is missing contact information." }, { status: 400 });
    }

    if (sentAt) {
      return json({
        ok: true,
        alreadySent: true,
        sent: false,
      });
    }

    const message = `Hi ${firstName}, we are reaching out to you from FIFA Final X BTS Half-Time Show Watch Party. We are pleased to have you with us! Please stay tuned for more information about the venue, the party, and the food. Thanks!`;
    const result = await sendTextSms({ to: phoneNumber, message });
    const deliveryStatus = result.ok
      ? WELCOME_SMS_DELIVERY_STATUS.SENT
      : result.skipped
        ? WELCOME_SMS_DELIVERY_STATUS.SKIPPED
        : WELCOME_SMS_DELIVERY_STATUS.FAILED;
    const errorMessage = result.ok
      ? null
      : result.error ?? (result.skipped ? "SMS send was skipped because Twilio is not configured." : "Failed to send welcome text.");

    await docRef.set({
      welcomeSmsAttemptedAt: new Date(),
      welcomeSmsDeliveryStatus: deliveryStatus,
      welcomeSmsErrorMessage: errorMessage,
      welcomeSmsSentAt: result.ok ? new Date() : null,
      welcomeSmsMessage: message,
      welcomeSmsSid: result.sid ?? null,
    }, { merge: true });

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

    return json({
      ok: true,
      alreadySent: false,
      sent: true,
      deliveryStatus,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send welcome text.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
