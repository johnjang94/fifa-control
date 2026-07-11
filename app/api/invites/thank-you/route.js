import { NextResponse } from "next/server";

import { getDb } from "../../../../lib/firestore";
import { sendAdminSms } from "../../../../lib/sms";
import { toInviteRequest } from "../../../../lib/invites";

const COLLECTION = "invite_requests";
const SURVEY_COMPLETION_ADMIN_SMS_DELIVERY_STATUS = {
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
    const firstName = String(invite.firstName ?? "").trim();
    const survey = snapshot.data()?.survey ?? null;
    const surveyCompletedAt = snapshot.data()?.surveyCompletedAt ?? null;
    const referredBy = String(survey?.referredBy ?? "").trim();
    const sentAt = snapshot.data()?.surveyCompletionAdminSmsSentAt ?? null;

    if (!firstName) {
      return json({ ok: false, error: "Invite is missing first name." }, { status: 400 });
    }

    if (!surveyCompletedAt) {
      return json({ ok: false, error: "Survey is not completed yet." }, { status: 400 });
    }

    if (sentAt) {
      return json({
        ok: true,
        alreadySent: true,
        sent: false,
      });
    }

    const message = referredBy
      ? `${firstName}, the friend of ${referredBy} has signed up for FIFA Final X BTS Half-Time Show Watchy Party.`
      : `${firstName} has signed up for FIFA Final X BTS Half-Time Show Watchy Party.`;
    const result = await sendAdminSms(message);
    const deliveryStatus = result.ok
      ? SURVEY_COMPLETION_ADMIN_SMS_DELIVERY_STATUS.SENT
      : result.skipped
        ? SURVEY_COMPLETION_ADMIN_SMS_DELIVERY_STATUS.SKIPPED
        : SURVEY_COMPLETION_ADMIN_SMS_DELIVERY_STATUS.FAILED;
    const errorMessage = result.ok
      ? null
      : result.error ?? (result.skipped ? "SMS send was skipped because Twilio is not configured." : "Failed to send admin text.");

    const primaryResult = result.results?.[0] ?? null;

    await docRef.set(
      {
        surveyCompletionAdminSmsAttemptedAt: new Date(),
        surveyCompletionAdminSmsDeliveryStatus: deliveryStatus,
        surveyCompletionAdminSmsErrorMessage: errorMessage,
        surveyCompletionAdminSmsSentAt: result.ok ? new Date() : null,
        surveyCompletionAdminSmsMessage: message,
        surveyCompletionAdminSmsSid: primaryResult?.sid ?? null,
      },
      { merge: true },
    );

    if (!result.ok) {
      return json(
        {
          ok: false,
          error: errorMessage ?? "Failed to send admin text.",
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
    const message = error instanceof Error ? error.message : "Failed to send admin text.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
