import { NextResponse } from "next/server";

import { getDb } from "../../../lib/firestore";
import { deleteInviteAndRelatedInquiries, findInviteRef } from "../../../lib/invite-deletion";
import { buildWelcomeSmsMessage, parseInvitePayload, toInviteRequest } from "../../../lib/invites";
import { sendAdminSms, sendTextSms } from "../../../lib/sms";
import { verifyAdminSession } from "../../../lib/admin";

const COLLECTION = "invite_requests";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-session-id",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
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

async function adminSessionMatches(request) {
  const sessionId = String(request.headers.get("x-admin-session-id") ?? "").trim();
  if (!sessionId) {
    return { ok: false };
  }

  return verifyAdminSession(getDb(), sessionId);
}

async function generateUniqueBarcode(db) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const barcode = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
    const snapshot = await db
      .collection(COLLECTION)
      .where("barcode", "==", barcode)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return barcode;
    }
  }

  throw new Error("Unable to allocate a barcode. Please try again.");
}

function normalizeRsvpValue(rsvp) {
  const normalized = String(rsvp ?? "").trim().toLowerCase();
  if (normalized === "maybe") {
    return "maybe";
  }

  if (normalized === "not going") {
    return "not going";
  }

  return "Going";
}

function buildRsvpSmsMessage(firstName, rsvp) {
  if (rsvp === "maybe") {
    return `Hi ${firstName}, we understand that you are busy. Still, we hope to have you at the party!`;
  }

  if (rsvp === "not going") {
    return `Hi ${firstName}, we are sorry to see you go! Still, thank you for letting us know!`;
  }

  return "";
}

function buildReturnToGoingSmsMessage(firstName) {
  return `Hi ${firstName}, glad to have you back!`;
}

function getInviteNotificationMessages(firstName, barcode) {
  return {
    welcome: buildWelcomeSmsMessage(firstName, barcode),
    admin: `${firstName} has signed up for FIFA Final X BTS Half-Time Show Watchy Party.`,
  };
}

function getDeliveryStatus(result) {
  if (result.ok) {
    return "sent";
  }

  if (result.skipped) {
    return "skipped";
  }

  return "failed";
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const payload = await parseInvitePayload(formData);
    const db = getDb();
    const barcode = await generateUniqueBarcode(db);

    const doc = await db.collection(COLLECTION).add({
      ...payload,
      barcode,
      createdAt: new Date(),
      source: "guest-home",
      status: "waitlist",
    });

    const invite = toInviteRequest(doc.id, {
      ...payload,
      barcode,
      createdAt: new Date(),
      source: "guest-home",
      status: "waitlist",
    });
    const firstName = String(invite.firstName ?? "").trim();
    const phoneNumber = String(invite.phoneNumber ?? "").replace(/\D/g, "");

    const notificationMessages = getInviteNotificationMessages(firstName, barcode);
    const notificationResults = await Promise.allSettled([
      phoneNumber
        ? sendTextSms({
            to: phoneNumber,
            message: notificationMessages.welcome,
          })
        : Promise.resolve({ ok: false, skipped: true }),
      firstName
        ? sendAdminSms(notificationMessages.admin)
        : Promise.resolve({ ok: false, skipped: true }),
    ]);

    const welcomeResult =
      notificationResults[0].status === "fulfilled"
        ? notificationResults[0].value
        : { ok: false, skipped: false, error: notificationResults[0].reason?.message ?? "Failed to send welcome text." };
    const adminResult =
      notificationResults[1].status === "fulfilled"
        ? notificationResults[1].value
        : { ok: false, skipped: false, error: notificationResults[1].reason?.message ?? "Failed to send admin text." };

    await doc.set(
      {
        welcomeSmsAttemptedAt: new Date(),
        welcomeSmsDeliveryStatus: getDeliveryStatus(welcomeResult),
        welcomeSmsErrorMessage: welcomeResult.ok
          ? null
          : welcomeResult.error ?? (welcomeResult.skipped ? "SMS send was skipped because Twilio is not configured." : "Failed to send welcome text."),
        welcomeSmsSentAt: welcomeResult.ok ? new Date() : null,
        welcomeSmsMessage: notificationMessages.welcome,
        welcomeSmsSid: welcomeResult.sid ?? null,
        registrationAdminSmsAttemptedAt: new Date(),
        registrationAdminSmsDeliveryStatus: getDeliveryStatus(adminResult),
        registrationAdminSmsErrorMessage: adminResult.ok
          ? null
          : adminResult.error ?? (adminResult.skipped ? "SMS send was skipped because Twilio is not configured." : "Failed to send admin text."),
        registrationAdminSmsSentAt: adminResult.ok ? new Date() : null,
        registrationAdminSmsMessage: notificationMessages.admin,
        registrationAdminSmsSid: adminResult.sid ?? null,
      },
      { merge: true },
    );

    return json({
      ok: true,
      id: doc.id,
      qrToken: doc.id,
      barcode,
      isWaitlist: true,
      notifications: {
        welcome: {
          ok: Boolean(welcomeResult.ok),
          deliveryStatus: getDeliveryStatus(welcomeResult),
        },
        registrationAdmin: {
          ok: Boolean(adminResult.ok),
          deliveryStatus: getDeliveryStatus(adminResult),
        },
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save invite request.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}

export async function GET(request) {
  const sessionCheck = await adminSessionMatches(request);
  const hasSessionHeader = Boolean(String(request.headers.get("x-admin-session-id") ?? "").trim());

  if (hasSessionHeader && !sessionCheck.ok) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!sessionCheck.ok) {
    return json({ ok: true });
  }

  const snapshot = await getDb().collection(COLLECTION).get();

  return json({
    ok: true,
    invites: snapshot.docs
      .slice()
      .sort((a, b) => {
        const aTime = a.data().createdAt?.toMillis?.() ?? 0;
        const bTime = b.data().createdAt?.toMillis?.() ?? 0;
        return bTime - aTime;
      })
      .slice(0, 100)
      .map((doc) => toInviteRequest(doc.id, doc.data())),
  });
}

export async function PATCH(request) {
  try {
    const sessionCheck = await adminSessionMatches(request);
    if (!sessionCheck.ok) {
      return json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const payload = await request.json();
    const inviteToken = String(payload?.inviteToken ?? "").trim();
    const rsvp = normalizeRsvpValue(payload?.rsvp);

    if (!inviteToken) {
      return json({ ok: false, error: "inviteToken is required." }, { status: 400 });
    }

    if (!["Going", "maybe", "not going"].includes(rsvp)) {
      return json({ ok: false, error: "Invalid RSVP value." }, { status: 400 });
    }

    const db = getDb();
    const docRef = await findInviteRef(db, inviteToken);

    if (!docRef) {
      return json({ ok: false, error: "Invite not found." }, { status: 404 });
    }

    const beforeSnapshot = await docRef.get();
    const beforeData = beforeSnapshot.data() ?? {};
    const firstName = String(beforeData.firstName ?? "").trim();
    const previousRsvp = normalizeRsvpValue(beforeData.rsvp ?? "Going");
    const isReturningToGoing =
      rsvp === "Going" && ["maybe", "not going"].includes(previousRsvp);
    const sentField =
      rsvp === "maybe"
        ? "rsvpSmsSentAtMaybe"
        : rsvp === "not going"
          ? "rsvpSmsSentAtNotGoing"
          : "";
    const message = firstName ? buildRsvpSmsMessage(firstName, rsvp) : "";
    const returnToGoingMessage = firstName ? buildReturnToGoingSmsMessage(firstName) : "";
    const returnToGoingSentField = "rsvpSmsSentAtGoingReturn";
    const shouldSendSms =
      (Boolean(sentField) && Boolean(message) && !beforeData?.[sentField]) ||
      (isReturningToGoing && Boolean(returnToGoingMessage) && !beforeData?.[returnToGoingSentField]);

    await docRef.set(
      {
        rsvp,
        updatedAt: new Date(),
      },
      { merge: true },
    );

    if (shouldSendSms) {
      const to = String(beforeData.phoneNumber ?? "").replace(/\D/g, "");
      const shouldUseReturnMessage = isReturningToGoing && !["maybe", "not going"].includes(rsvp);
      const smsResult = await sendTextSms({
        to,
        message: shouldUseReturnMessage ? returnToGoingMessage : message,
      }).catch(() => ({ ok: false }));

      if (smsResult.ok) {
        const smsFields = shouldUseReturnMessage
          ? {
              [returnToGoingSentField]: new Date(),
              [`${returnToGoingSentField}Message`]: returnToGoingMessage,
            }
          : {
              [sentField]: new Date(),
              [`${sentField}Message`]: message,
            };

        await docRef.set(smsFields, { merge: true });
      }
    }

    const snapshot = await docRef.get();
    return json({
      ok: true,
      user: toInviteRequest(snapshot.id, snapshot.data() ?? {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update RSVP.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(request) {
  const sessionCheck = await adminSessionMatches(request);
  if (!sessionCheck.ok) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const inviteToken = String(request.nextUrl.searchParams.get("inviteToken") ?? "").trim();
  if (!inviteToken) {
    return json({ ok: false, error: "inviteToken is required." }, { status: 400 });
  }

  try {
    const result = await deleteInviteAndRelatedInquiries(getDb(), inviteToken);
    if (!result) {
      return json({ ok: false, error: "Invite not found." }, { status: 404 });
    }

    return json({
      ok: true,
      user: result.invite,
      deletedInquiryCount: result.deletedInquiryCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete invite.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
