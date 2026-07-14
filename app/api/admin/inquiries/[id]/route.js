import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { toInquiryItem } from "../../../../../lib/inquiry";
import { maybeAppendHumanTimeoutNotice } from "../../../../../lib/human-response";
import { sendTextSms } from "../../../../../lib/sms";
import { verifyAdminSession } from "../../../../../lib/admin";
import { SUPPORT_CHAT_COLLECTION } from "../../../../../lib/support-chat-inquiries";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-session-id",
  "Access-Control-Allow-Methods": "POST,PATCH,OPTIONS",
};

function json(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) },
  });
}

async function adminSessionMatches(request) {
  const sessionId = String(request.headers.get("x-admin-session-id") ?? "").trim();
  if (!sessionId) {
    return { ok: false };
  }

  const result = await verifyAdminSession(getDb(), sessionId);
  return result.ok ? { ok: true, session: result.session } : { ok: false };
}

function buildHumanConnectionSmsMessage(managerName) {
  const name = String(managerName ?? "").trim() || "an admin";
  return `You have been connected with ${name}. Please return to the chat as soon as possible.`;
}

function buildHumanReplySmsMessage(managerName) {
  const name = String(managerName ?? "").trim() || "an admin";
  return `You've received a reply from ${name}.`;
}

function normalizeAgentName(value) {
  const name = String(value ?? "").trim();
  const lower = name.toLowerCase();
  if (!name || lower === "unassigned" || lower === "admin" || lower === "miranda") {
    return "";
  }

  return name;
}

async function resolveInquiryDocRef(db, inquiryKey) {
  const safeKey = String(inquiryKey ?? "").trim();
  if (!safeKey) {
    return null;
  }

  const primaryRef = db.collection(SUPPORT_CHAT_COLLECTION).doc(safeKey);
  const primarySnapshot = await primaryRef.get();
  if (primarySnapshot.exists) {
    return primaryRef;
  }

  const fields = ["inviteId", "inviteToken"];
  for (const field of fields) {
    const primaryQuery = await db
      .collection(SUPPORT_CHAT_COLLECTION)
      .where(field, "==", safeKey)
      .limit(1)
      .get();
    if (!primaryQuery.empty) {
      return primaryQuery.docs[0].ref;
    }
  }

  return null;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request, { params }) {
  const sessionCheck = await adminSessionMatches(request);
  if (!sessionCheck.ok) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const inquiryKey = String(params?.id ?? "").trim();
    if (!inquiryKey) {
      return json({ ok: false, error: "Inquiry id is required." }, { status: 400 });
    }

    const payload = await request.json();
    const message = typeof payload?.message === "string" ? payload.message.trim() : "";

    if (!message) {
      return json({ ok: false, error: "message is required." }, { status: 400 });
    }

    const db = getDb();
    const docRef = await resolveInquiryDocRef(db, inquiryKey);
    if (!docRef) {
      return json({ ok: false, error: "Ticket not found." }, { status: 404 });
    }

    const snapshot = await docRef.get();

    const data = snapshot.data() ?? {};
    const timeoutCheck = maybeAppendHumanTimeoutNotice(data);
    const sourceData = timeoutCheck.appended ? timeoutCheck.data : data;
    const thread = Array.isArray(sourceData.thread) ? sourceData.thread : [];
    const shouldNotifyUser = String(sourceData.phoneNumber ?? "").replace(/\D/g, "").length > 0;
    const existingAgentName = normalizeAgentName(sourceData.currentAgent ?? sourceData.assignedTo);
    const existingAssignedName = normalizeAgentName(sourceData.assignedTo);
    const incomingAgentName = normalizeAgentName(payload?.agentName);
    const resolvedAgentName = existingAgentName || incomingAgentName || "Admin";
    const now = new Date().toISOString();
    const nextThread = [
      ...thread,
      {
        role: "agent",
        senderName: resolvedAgentName,
        message,
        createdAt: now,
      },
    ];

    const nextData = {
      ...sourceData,
      thread: nextThread,
      answer: message,
      currentAgent: resolvedAgentName,
      assignedTo: existingAssignedName || resolvedAgentName,
      status: String(payload?.status ?? "in progress"),
      humanAcknowledgedAt: sourceData.humanAcknowledgedAt ?? new Date(),
      humanConnectionSmsSentAt: sourceData.humanConnectionSmsSentAt ?? null,
      humanTimeoutNoticeAt: sourceData.humanTimeoutNoticeAt ?? null,
      updatedAt: new Date(),
    };

    if (shouldNotifyUser) {
      const managerName = resolvedAgentName;
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
      inquiry: toInquiryItem(snapshot.id, nextData),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update inquiry.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}

export async function PATCH(request, { params }) {
  const sessionCheck = await adminSessionMatches(request);
  if (!sessionCheck.ok) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const inquiryKey = String(params?.id ?? "").trim();
    if (!inquiryKey) {
      return json({ ok: false, error: "Inquiry id is required." }, { status: 400 });
    }

    const db = getDb();
    const docRef = await resolveInquiryDocRef(db, inquiryKey);
    if (!docRef) {
      return json({ ok: false, error: "Ticket not found." }, { status: 404 });
    }

    const snapshot = await docRef.get();

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
      inquiry: toInquiryItem(snapshot.id, nextData),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update inquiry.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
