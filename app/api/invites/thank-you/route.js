import { NextResponse } from "next/server";

import { getDb } from "../../../../lib/firestore";
import { sendAdminSms } from "../../../../lib/sms";
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
    const firstName = String(invite.firstName ?? "").trim();
    const sentAt = snapshot.data()?.thankYouAdminSmsSentAt ?? null;

    if (!firstName) {
      return json({ ok: false, error: "Invite is missing first name." }, { status: 400 });
    }

    if (sentAt) {
      return json({
        ok: true,
        alreadySent: true,
        sent: false,
      });
    }

    const message = `${firstName} has signed up for the watch party!`;
    const result = await sendAdminSms(message);

    if (!result.ok) {
      return json(
        {
          ok: false,
          error: "Failed to send admin text.",
        },
        { status: 502 },
      );
    }

    const primaryResult = result.results?.[0] ?? null;

    await docRef.set(
      {
        thankYouAdminSmsSentAt: new Date(),
        thankYouAdminSmsMessage: message,
        thankYouAdminSmsSid: primaryResult?.sid ?? null,
      },
      { merge: true },
    );

    return json({
      ok: true,
      alreadySent: false,
      sent: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send admin text.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
