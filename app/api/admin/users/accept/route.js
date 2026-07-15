import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { getInviteSettings } from "../../../../../lib/settings";
import { sendTextSms } from "../../../../../lib/sms";
import { toInviteRequest } from "../../../../../lib/invites";
import { verifyAdminSession } from "../../../../../lib/admin";

const COLLECTION = "invite_requests";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-session-id",
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

async function adminSessionMatches(request) {
  const sessionId = String(request.headers.get("x-admin-session-id") ?? "").trim();
  if (!sessionId) {
    return { ok: false };
  }

  return verifyAdminSession(getDb(), sessionId);
}

function countConfirmedInvites(snapshot) {
  return snapshot.docs.reduce((count, doc) => {
    const status = String(doc.data()?.status ?? "").trim().toLowerCase();
    return status === "confirmed" ? count + 1 : count;
  }, 0);
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request) {
  try {
    const sessionCheck = await adminSessionMatches(request);
    if (!sessionCheck.ok) {
      return json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (String(sessionCheck.session?.role ?? "manager").trim().toLowerCase() === "operator") {
      return json({ ok: false, error: "Operator accounts cannot accept waitlisted guests." }, { status: 403 });
    }

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

    const beforeData = snapshot.data() ?? {};
    const currentStatus = String(beforeData.status ?? "").trim().toLowerCase();

    if (currentStatus === "confirmed") {
      return json({
        ok: true,
        accepted: false,
        alreadyAccepted: true,
        user: toInviteRequest(snapshot.id, beforeData),
      });
    }

    const settings = await getInviteSettings(db);
    const allSnapshot = await db.collection(COLLECTION).get();
    const confirmedCount = countConfirmedInvites(allSnapshot);

    if (settings.capacity !== null && confirmedCount >= settings.capacity) {
      return json({ ok: false, error: "Party capacity has been reached." }, { status: 400 });
    }

    const invite = toInviteRequest(snapshot.id, beforeData);
    const firstName = String(invite.firstName ?? "").trim() || "there";
    const phoneNumber = String(invite.phoneNumber ?? "").replace(/\D/g, "");
    const message = `Hi ${firstName}, we are fro FIFA Final X BTS Half-Time Show Watch Party. Congrats! We are pleased to have you with us! Please come to the following website and get more information about the party: https://fifa-half-time-show.vercel.app/`;

    await docRef.set(
      {
        status: "confirmed",
        attendance: "Going",
        registeredAt: new Date(),
        acceptedToPartyAt: new Date(),
        updatedAt: new Date(),
      },
      { merge: true },
    );

    let deliveryStatus = "skipped";
    let errorMessage = null;
    let smsSid = null;

    if (phoneNumber) {
      const result = await sendTextSms({ to: phoneNumber, message }).catch(() => ({ ok: false }));
      deliveryStatus = result.ok ? "sent" : result.skipped ? "skipped" : "failed";
      errorMessage = result.ok
        ? null
        : result.error ?? (result.skipped ? "SMS send was skipped because Twilio is not configured." : "Failed to send acceptance text.");
      smsSid = result.sid ?? null;

      await docRef.set(
        {
          acceptanceSmsAttemptedAt: new Date(),
          acceptanceSmsDeliveryStatus: deliveryStatus,
          acceptanceSmsErrorMessage: errorMessage,
          acceptanceSmsSentAt: result.ok ? new Date() : null,
          acceptanceSmsMessage: message,
          acceptanceSmsSid: smsSid,
        },
        { merge: true },
      );
    }

    const refreshedSnapshot = await docRef.get();
    return json({
      ok: true,
      accepted: true,
      deliveryStatus,
      notificationDeliveryStatus: deliveryStatus,
      user: toInviteRequest(refreshedSnapshot.id, refreshedSnapshot.data() ?? {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to accept user.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
