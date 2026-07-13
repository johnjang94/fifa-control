import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { toInquiryItem } from "../../../../../lib/inquiry";
import { maybeAppendHumanTimeoutNotice } from "../../../../../lib/human-response";
import { sendTextSms } from "../../../../../lib/sms";

const COLLECTION = "guest_faq_inquiries";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST,PATCH,OPTIONS",
};

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
    const timeoutCheck = maybeAppendHumanTimeoutNotice(data);
    const sourceData = timeoutCheck.appended ? timeoutCheck.data : data;
    const thread = Array.isArray(sourceData.thread) ? sourceData.thread : [];
    const shouldNotifyUser =
      Boolean(sourceData.humanRequestedAt) &&
      String(sourceData.phoneNumber ?? "").replace(/\D/g, "").length > 0;
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
      ...sourceData,
      thread: nextThread,
      answer: message,
      currentAgent: String(payload?.agentName ?? sourceData.currentAgent ?? "Admin"),
      status: String(payload?.status ?? "in progress"),
      humanAcknowledgedAt: sourceData.humanAcknowledgedAt ?? new Date(),
      humanConnectionSmsSentAt: sourceData.humanConnectionSmsSentAt ?? null,
      humanTimeoutNoticeAt: sourceData.humanTimeoutNoticeAt ?? null,
      updatedAt: new Date(),
    };

    if (shouldNotifyUser) {
      const managerName = String(payload?.agentName ?? nextData.currentAgent ?? "Admin").trim() || "Admin";
      const phoneNumber = String(sourceData.phoneNumber ?? "").replace(/\D/g, "");
      const notification = buildHumanReplySmsMessage(managerName);

      try {
        const smsResult = await sendTextSms({ to: phoneNumber, message: notification });
        if (smsResult.ok && !sourceData.humanConnectionSmsSentAt) {
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
    const timeoutCheck = maybeAppendHumanTimeoutNotice(data);
    const sourceData = timeoutCheck.appended ? timeoutCheck.data : data;
    const nextData = {
      ...sourceData,
      humanAcknowledgedAt: sourceData.humanAcknowledgedAt ?? new Date(),
      status: String(sourceData.status ?? "human requested"),
      humanConnectionSmsSentAt: sourceData.humanConnectionSmsSentAt ?? null,
      humanTimeoutNoticeAt: sourceData.humanTimeoutNoticeAt ?? null,
      updatedAt: new Date(),
    };

    if (!sourceData.humanConnectionSmsSentAt && sourceData.humanRequestedAt) {
      const managerName = String(sourceData.currentAgent ?? "Admin").trim() || "Admin";
      const phoneNumber = String(sourceData.phoneNumber ?? "").replace(/\D/g, "");
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
