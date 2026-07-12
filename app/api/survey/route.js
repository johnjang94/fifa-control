import { NextResponse } from "next/server";

import { getDb } from "../../../lib/firestore";
import { toInviteRequest } from "../../../lib/invites";
import { sendAdminSms } from "../../../lib/sms";

const COLLECTION = "invite_requests";
const ALLOWED_SOURCES = new Set(["Friends", "LinkedIn", "Eventbrite", "Instagram", "X"]);
const ALLOWED_RESIDENT_VALUES = new Set(["Yes", "No"]);
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
    headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) },
  });
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function findInviteDoc(db, inviteToken, contactPhoneNumber = "") {
  const candidates = [inviteToken, contactPhoneNumber]
    .map((value) => normalizeString(value))
    .filter(Boolean);

  for (const candidate of candidates) {
    const directSnapshot = await db.collection(COLLECTION).doc(candidate).get();
    if (directSnapshot.exists) {
      return directSnapshot.ref;
    }

    const phoneNumber = candidate.replace(/\D/g, "");
    if (!phoneNumber) {
      continue;
    }

    const phoneSnapshot = await db
      .collection(COLLECTION)
      .where("phoneNumber", "==", phoneNumber)
      .limit(1)
      .get();

    if (!phoneSnapshot.empty) {
      return phoneSnapshot.docs[0].ref;
    }
  }

  return null;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const inviteToken = normalizeString(payload?.inviteToken);
    const contactPhoneNumber = normalizeString(payload?.contactPhoneNumber);
    const howDidYouKnow = normalizeString(payload?.howDidYouKnow);
    const referredBy = normalizeString(payload?.referredBy);
    const dietaryRestrictions = normalizeString(payload?.dietaryRestrictions);
    const resident = normalizeString(payload?.resident);

    if (!inviteToken) {
      return json({ ok: false, error: "inviteToken is required." }, { status: 400 });
    }

    if (!ALLOWED_SOURCES.has(howDidYouKnow)) {
      return json({ ok: false, error: "Please choose how you heard about the event." }, { status: 400 });
    }

    if (howDidYouKnow === "Friends" && !referredBy) {
      return json({ ok: false, error: "Please tell us who referred you." }, { status: 400 });
    }

    if (!dietaryRestrictions) {
      return json({ ok: false, error: "Please share your dietary restrictions." }, { status: 400 });
    }

    if (!ALLOWED_RESIDENT_VALUES.has(resident)) {
      return json({ ok: false, error: "Please answer whether you live in the building." }, { status: 400 });
    }

    const db = getDb();
    const docRef = await findInviteDoc(db, inviteToken, contactPhoneNumber);

    if (!docRef) {
      return json({ ok: false, error: "Invite not found." }, { status: 404 });
    }

    const survey = {
      howDidYouKnow,
      referredBy: howDidYouKnow === "Friends" ? referredBy : "",
      dietaryRestrictions,
      resident,
      submittedAt: new Date(),
    };

    await docRef.set(
      {
        survey,
        surveyCompletedAt: new Date(),
        updatedAt: new Date(),
      },
      { merge: true },
    );

    const snapshot = await docRef.get();
    const firstName = String(snapshot.data()?.firstName ?? "").trim();
    const surveyData = snapshot.data()?.survey ?? survey;
    const surveyReferredBy = String(surveyData?.referredBy ?? "").trim();
    const sentAt = snapshot.data()?.surveyCompletionAdminSmsSentAt ?? null;

    if (firstName && !sentAt) {
      const message = surveyReferredBy
        ? `${firstName}, the friend of ${surveyReferredBy} has signed up for FIFA Final X BTS Half-Time Show Watchy Party.`
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
    }

    const refreshedSnapshot = await docRef.get();
    return json({
      ok: true,
      user: toInviteRequest(refreshedSnapshot.id, refreshedSnapshot.data() ?? {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save survey.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
