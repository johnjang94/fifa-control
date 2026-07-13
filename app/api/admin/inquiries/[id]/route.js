import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { toInquiryItem } from "../../../../../lib/inquiry";
import { sendTextSms } from "../../../../../lib/sms";

const COLLECTION = "guest_faq_inquiries";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST,PATCH,OPTIONS",
};
const SUPPORT_PRESENCE_WINDOW_MS = 45 * 1000;

function json(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) },
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

function buildHumanConnectionSmsMessage(managerName) {
  const name = String(managerName ?? "").trim() || "an admin";
  return `You have been connected with ${name}. Please return to the chat as soon as possible.`;
}

function buildHumanReplySmsMessage(managerName) {
  const name = String(managerName ?? "").trim() || "an admin";
  return `You've received a reply from ${name}.`;
}

function getTimestamp(value) {
  if (!value) {
    return 0;
  }

  if (typeof value === "string") {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  if (typeof value.toDate === "function") {
    const timestamp = value.toDate().getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  if (typeof value === "object" && value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  return 0;
}

function isUserActiveInChat(data) {
  const activeState = String(data.supportChatState ?? "").toLowerCase();
  const activeAt = getTimestamp(data.supportChatActiveAt);
  return activeState === "active" && activeAt > 0 && Date.now() - activeAt <= SUPPORT_PRESENCE_WINDOW_MS;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request, { params }) {
  if (!adminKeyMatches(request)) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const message = typeof payload?.message === "string" ? payload.message.trim() : "";

    if (!message) {
      return json({ ok: false, error: "message is required." }, { status: 400 });
    }

    const docRef = getDb().collection(COLLECTION).doc(params.id);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      return json({ ok: false, error: "Ticket not found." }, { status: 404 });
    }

    const data = snapshot.data() ?? {};
    const thread = Array.isArray(data.thread) ? data.thread : [];
    const shouldNotifyUser =
      Boolean(data.humanRequestedAt) &&
      String(data.phoneNumber ?? "").replace(/\D/g, "").length > 0;
    const now = new Date().toISOString();
    const nextThread = [
      ...thread,
      {
        role: "agent",
        message,
        createdAt: now,
      },
    ];

    const nextData = {
      ...data,
      thread: nextThread,
      answer: message,
      currentAgent: String(payload?.agentName ?? data.currentAgent ?? "Admin"),
      status: String(payload?.status ?? "in progress"),
      humanAcknowledgedAt: data.humanAcknowledgedAt ?? new Date(),
      humanConnectionSmsSentAt: data.humanConnectionSmsSentAt ?? null,
      updatedAt: new Date(),
    };

    if (shouldNotifyUser) {
      const managerName = String(payload?.agentName ?? nextData.currentAgent ?? "Admin").trim() || "Admin";
      const phoneNumber = String(data.phoneNumber ?? "").replace(/\D/g, "");
      if (!data.humanConnectionSmsSentAt) {
        const notification = buildHumanConnectionSmsMessage(managerName);

        try {
          const smsResult = await sendTextSms({ to: phoneNumber, message: notification });
          if (smsResult.ok) {
            nextData.humanConnectionSmsSentAt = new Date();
          }
        } catch {
          // Best effort only.
        }
      } else if (!isUserActiveInChat(data)) {
        const notification = buildHumanReplySmsMessage(managerName);

        try {
          await sendTextSms({ to: phoneNumber, message: notification });
        } catch {
          // Best effort only.
        }
      }
    }

    await docRef.set(nextData, { merge: true });

    return json({
      ok: true,
      inquiry: toInquiryItem(params.id, nextData),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update inquiry.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}

export async function PATCH(request, { params }) {
  if (!adminKeyMatches(request)) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const docRef = getDb().collection(COLLECTION).doc(params.id);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      return json({ ok: false, error: "Ticket not found." }, { status: 404 });
    }

    const data = snapshot.data() ?? {};
    const nextData = {
      ...data,
      humanAcknowledgedAt: data.humanAcknowledgedAt ?? new Date(),
      status: String(data.status ?? "human requested"),
      humanConnectionSmsSentAt: data.humanConnectionSmsSentAt ?? null,
      updatedAt: new Date(),
    };

    if (!data.humanConnectionSmsSentAt && data.humanRequestedAt) {
      const managerName = String(data.currentAgent ?? "Admin").trim() || "Admin";
      const phoneNumber = String(data.phoneNumber ?? "").replace(/\D/g, "");
      const notification = buildHumanConnectionSmsMessage(managerName);

      try {
        const smsResult = await sendTextSms({ to: phoneNumber, message: notification });
        if (smsResult.ok) {
          nextData.humanConnectionSmsSentAt = new Date();
        }
      } catch {
        // Best effort only.
      }
    }

    await docRef.set(nextData, { merge: true });

    return json({
      ok: true,
      inquiry: toInquiryItem(params.id, nextData),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update inquiry.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
