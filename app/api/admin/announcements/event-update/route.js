import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { buildEventUpdateSmsMessage, toInviteRequest } from "../../../../../lib/invites";
import { sendTextSms } from "../../../../../lib/sms";
import { verifyAdminSession } from "../../../../../lib/admin";

const COLLECTION = "invite_requests";
const EVENT_UPDATE_DELIVERY_STATUS = {
  SENT: "sent",
  FAILED: "failed",
  SKIPPED: "skipped",
};
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

function normalizePhoneNumber(value) {
  return String(value ?? "").replace(/\D/g, "");
}

async function adminSessionMatches(db, request) {
  const sessionId = String(request.headers.get("x-admin-session-id") ?? "").trim();
  if (!sessionId) {
    return { ok: false, error: "Admin session is required." };
  }

  return verifyAdminSession(db, sessionId);
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const mode = String(payload?.mode ?? "").trim().toLowerCase();
    const requestedInviteToken = String(payload?.inviteToken ?? "").trim();
    const db = getDb();
    const sessionCheck = await adminSessionMatches(db, request);

    if (!sessionCheck.ok) {
      return json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (mode !== "all" && mode !== "single") {
      return json({ ok: false, error: "mode must be either 'all' or 'single'." }, { status: 400 });
    }

    if (mode === "single" && !requestedInviteToken) {
      return json({ ok: false, error: "inviteToken is required for single mode." }, { status: 400 });
    }

    const snapshot = await db.collection(COLLECTION).get();
    const uniqueRecipients = new Map();

    snapshot.docs.forEach((doc) => {
      if (mode === "single" && doc.id !== requestedInviteToken) {
        return;
      }

      const invite = toInviteRequest(doc.id, doc.data() ?? {});
      const phoneNumber = normalizePhoneNumber(invite.phoneNumber);
      const firstName = String(invite.firstName ?? "").trim();

      if (!phoneNumber || !firstName) {
        return;
      }

      if (!uniqueRecipients.has(phoneNumber)) {
        uniqueRecipients.set(phoneNumber, { invite, doc });
      }
    });

    const recipients = [...uniqueRecipients.values()];

    if (!recipients.length) {
      return json({
        ok: true,
        sent: 0,
        skipped: 0,
        failed: 0,
        results: [],
        target: mode,
      });
    }

    const broadcastId = new Date().toISOString();
    const results = [];

    for (const { invite, doc } of recipients) {
      const firstName = String(invite.firstName ?? "").trim();
      const phoneNumber = normalizePhoneNumber(invite.phoneNumber);
      const message = buildEventUpdateSmsMessage(firstName);
      const result = await sendTextSms({ to: phoneNumber, message });
      const deliveryStatus = result.ok
        ? EVENT_UPDATE_DELIVERY_STATUS.SENT
        : result.skipped
          ? EVENT_UPDATE_DELIVERY_STATUS.SKIPPED
          : EVENT_UPDATE_DELIVERY_STATUS.FAILED;

      await doc.ref.set(
        {
          eventUpdateSmsBroadcastId: broadcastId,
          eventUpdateSmsAttemptedAt: new Date(),
          eventUpdateSmsDeliveryStatus: deliveryStatus,
          eventUpdateSmsErrorMessage: result.ok
            ? null
            : result.error ??
              (result.skipped
                ? "SMS send was skipped because Twilio is not configured."
                : "Failed to send event update text."),
          eventUpdateSmsSentAt: result.ok ? new Date() : null,
          eventUpdateSmsMessage: message,
          eventUpdateSmsSid: result.sid ?? null,
        },
        { merge: true },
      );

      results.push({
        phoneNumber,
        ok: Boolean(result.ok),
        skipped: Boolean(result.skipped),
        deliveryStatus,
      });
    }

    return json({
      ok: true,
      broadcastId,
      sent: results.filter((item) => item.ok).length,
      skipped: results.filter((item) => item.skipped).length,
      failed: results.filter((item) => !item.ok && !item.skipped).length,
      results,
      target: mode,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send event update text.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
