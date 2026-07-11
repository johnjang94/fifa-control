import { NextResponse } from "next/server";

import { getDb } from "../../../../lib/firestore";
import { sendTextSms } from "../../../../lib/sms";
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

    const invite = toInviteRequest(snapshot.id, snapshot.data() ?? {});
    const phoneNumber = String(invite.phoneNumber ?? "").replace(/\D/g, "");
    const firstName = String(invite.firstName ?? "").trim();
    const inviteStatus = String(invite.status ?? "").toLowerCase();
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

    const message =
      inviteStatus === "waitlist"
        ? "Thank you for your interest in joining us! We will let you know as soon as the spot is available"
        : `Hi ${firstName}, we are from FIFA Final X BTS Half-Time Show Watch Party. We would like to welcome you to the watch party! Thank you for joining us! You've been successfully signed up for the party! We look forward to seeing you!`;
    const result = await sendTextSms({ to: phoneNumber, message });

    if (!result.ok) {
      return json(
        {
          ok: false,
          error: result.error ?? "Failed to send welcome text.",
        },
        { status: 502 },
      );
    }

    await docRef.set(
      {
        welcomeSmsSentAt: new Date(),
        welcomeSmsMessage: message,
        welcomeSmsSid: result.sid ?? null,
        welcomeSmsVariant: inviteStatus === "waitlist" ? "waitlist" : "confirmed",
      },
      { merge: true },
    );

    return json({
      ok: true,
      alreadySent: false,
      sent: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send welcome text.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
