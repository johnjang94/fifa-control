import { NextResponse } from "next/server";

import { getDb } from "../../../../lib/firestore";
import {
  buildSupportReason,
  buildSupportThreadTitle,
  createTicketCode,
  parseSupportPayload,
  toInquiryItem,
} from "../../../../lib/inquiry";
import { maybeAppendHumanTimeoutNotice } from "../../../../lib/human-response";
import { toInviteRequest } from "../../../../lib/invites";
import { sendSupportSms, sendTextSms } from "../../../../lib/sms";
import { getAuthorizedInvite } from "../../../../lib/support-access";
import { verifyAdminSession } from "../../../../lib/admin";
import {
  SUPPORT_CHAT_COLLECTION,
} from "../../../../lib/support-chat-inquiries";

const INVITE_COLLECTION = "invite_requests";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-support-access-token, x-admin-session-id",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function json(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...CORS_HEADERS, ...(init?.headers ?? {}) },
  });
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function getInquiryDocRef(db, ticketId) {
  const primaryRef = db.collection(SUPPORT_CHAT_COLLECTION).doc(ticketId);
  const primarySnapshot = await primaryRef.get();
  if (primarySnapshot.exists) {
    return primaryRef;
  }

  return primaryRef;
}

async function getAuthorizedAdmin(request) {
  const sessionId = String(request.headers.get("x-admin-session-id") ?? "").trim();
  if (!sessionId) {
    return null;
  }

  const result = await verifyAdminSession(getDb(), sessionId);
  if (!result.ok) {
    return null;
  }

  return result.session;
}

function buildSupportSmsMessage({ customerName, requestReason, isNewTicket, wantsHumanSupport }) {
  const displayName = typeof customerName === "string" ? customerName.trim() : "";
  const subject = displayName ? `${displayName} ` : "";
  const reason = typeof requestReason === "string" ? requestReason.trim() : "";
  const reasonSuffix = reason ? ` Reason: ${reason.slice(0, 140)}` : "";

  if (isNewTicket) {
    return `Host alert: ${subject}started a new support chat.${reasonSuffix}`;
  }

  if (wantsHumanSupport) {
    return `Host alert: ${subject}asked for live support in the chat.${reasonSuffix}`;
  }

  return `Host alert: ${subject}sent a support message.${reasonSuffix}`;
}

function buildCustomerReplySmsMessage(agentName) {
  const name = String(agentName ?? "").trim() || "an admin";
  return `You've received a reply from ${name}.`;
}

function formatAdminName(session, fallback = "Admin") {
  const firstName = normalizeString(session?.firstName);
  const lastName = normalizeString(session?.lastName);
  return [firstName, lastName].filter(Boolean).join(" ").trim() || fallback;
}

async function maybeSendSupportSms({
  customerName,
  requestReason,
  wantsHumanSupport,
  isNewTicket,
  existingHumanRequestedAt,
}) {
  const shouldNotify = isNewTicket || (wantsHumanSupport && !existingHumanRequestedAt);
  if (!shouldNotify) {
    return;
  }

  try {
    await sendSupportSms(
      buildSupportSmsMessage({
        customerName,
        requestReason,
        isNewTicket,
        wantsHumanSupport,
      }),
    );
  } catch {
    // SMS notifications are best effort only.
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request) {
  const ticketId = request.nextUrl.searchParams.get("ticketId") ?? "";
  if (!ticketId) {
    return json({ ok: false, error: "ticketId is required." }, { status: 400 });
  }

  const db = getDb();
  const authorizedInvite = await getAuthorizedInvite(db, request);
  if (!authorizedInvite) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const primarySnapshot = await db.collection(SUPPORT_CHAT_COLLECTION).doc(ticketId).get();
  if (!primarySnapshot.exists) {
    return json({ ok: false, error: "Ticket not found." }, { status: 404 });
  }

  const data = primarySnapshot.data() ?? {};
  const ticketInviteId = String(data.inviteId ?? "").trim();
  const ticketPhoneNumber = String(data.phoneNumber ?? "").replace(/\D/g, "");
  if (ticketInviteId && ticketInviteId !== authorizedInvite.id) {
    return json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }
  if (!ticketInviteId && ticketPhoneNumber && ticketPhoneNumber !== authorizedInvite.phoneNumber) {
    return json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }

  return json({
    ok: true,
    inquiry: toInquiryItem(primarySnapshot.id, data),
  });
}

export async function POST(request) {
  try {
    const payload = parseSupportPayload(await request.json());
    const db = getDb();
    const adminSession = await getAuthorizedAdmin(request);
    const senderRole = normalizeString(payload.senderRole).toLowerCase();
    const isAgentMessage = Boolean(adminSession) && senderRole === "agent";
    const authorizedInvite = isAgentMessage ? null : await getAuthorizedInvite(db, request);

    if (!adminSession && !authorizedInvite) {
      return json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const currentMessage = String(payload.message ?? "");
    const now = new Date();

    let docRef = null;
    let existingData = {};
    let existingThread = [];
    let existingQuestion = "";
    let existingAnswer = "";
    let existingStatus = "open";
    let existingCurrentAgent = "Unassigned";
    let existingAssignedTo = "Unassigned";
    let existingCreatedAt = null;
    let existingHumanRequestedAt = null;
    let existingHumanAcknowledgedAt = null;
    let existingHumanConnectionSmsSentAt = null;
    let existingHumanTimeoutNoticeAt = null;
    let existingTicketCode = "";
    let inviteName = "";
    let invitePhone = "";
    let customerPhotoUrl = null;
    let phoneNumber = "";

    if (authorizedInvite) {
      const inviteSnapshot = await db.collection(INVITE_COLLECTION).doc(authorizedInvite.id).get();
      const invite = inviteSnapshot.exists ? toInviteRequest(inviteSnapshot.id, inviteSnapshot.data() ?? {}) : null;
      inviteName = invite ? `${invite.firstName} ${invite.lastName}`.trim() : "";
      invitePhone = invite?.phoneNumber || "";
      customerPhotoUrl = invite?.profilePhotoUrl ?? null;
      phoneNumber = authorizedInvite.phoneNumber || invitePhone || "";
    }

    if (payload.ticketId) {
      docRef = await getInquiryDocRef(db, payload.ticketId);
      const snapshot = await docRef.get();
      if (snapshot.exists) {
        existingData = snapshot.data() ?? {};
        const ticketInviteId = String(existingData.inviteId ?? "").trim();
        const ticketPhoneNumber = String(existingData.phoneNumber ?? "").replace(/\D/g, "");
        if (authorizedInvite && ticketInviteId && ticketInviteId !== authorizedInvite.id) {
          return json({ ok: false, error: "Unauthorized" }, { status: 403 });
        }
        if (authorizedInvite && !ticketInviteId && ticketPhoneNumber && ticketPhoneNumber !== authorizedInvite.phoneNumber) {
          return json({ ok: false, error: "Unauthorized" }, { status: 403 });
        }
        existingThread = Array.isArray(existingData.thread) ? existingData.thread : [];
        existingQuestion = String(existingData.question ?? "");
        existingAnswer = String(existingData.answer ?? "");
        existingStatus = String(existingData.status ?? "open");
        existingCurrentAgent = String(existingData.currentAgent ?? "Unassigned");
        existingAssignedTo = String(existingData.assignedTo ?? "Unassigned");
        existingCreatedAt = existingData.createdAt ?? null;
        existingHumanRequestedAt = existingData.humanRequestedAt ?? null;
        existingHumanAcknowledgedAt = existingData.humanAcknowledgedAt ?? null;
        existingHumanConnectionSmsSentAt = existingData.humanConnectionSmsSentAt ?? null;
        existingHumanTimeoutNoticeAt = existingData.humanTimeoutNoticeAt ?? null;
        existingTicketCode = String(existingData.ticketCode ?? "").trim();
        const timeoutCheck = maybeAppendHumanTimeoutNotice(existingData);
        if (timeoutCheck.appended) {
          existingThread = Array.isArray(timeoutCheck.data.thread) ? timeoutCheck.data.thread : existingThread;
          existingHumanRequestedAt = timeoutCheck.data.humanRequestedAt ?? existingHumanRequestedAt;
          existingHumanAcknowledgedAt = timeoutCheck.data.humanAcknowledgedAt ?? existingHumanAcknowledgedAt;
          existingHumanConnectionSmsSentAt =
            timeoutCheck.data.humanConnectionSmsSentAt ?? existingHumanConnectionSmsSentAt;
          existingHumanTimeoutNoticeAt =
            timeoutCheck.data.humanTimeoutNoticeAt ?? existingHumanTimeoutNoticeAt;
          existingStatus = timeoutCheck.data.status ?? existingStatus;
          existingCurrentAgent = timeoutCheck.data.currentAgent ?? existingCurrentAgent;
          existingAssignedTo = timeoutCheck.data.assignedTo ?? existingAssignedTo;
          existingCreatedAt = timeoutCheck.data.createdAt ?? existingCreatedAt;
          existingTicketCode = timeoutCheck.data.ticketCode ?? existingTicketCode;
          existingData = timeoutCheck.data;
        }
      } else if (isAgentMessage) {
        return json({ ok: false, error: "Ticket not found." }, { status: 404 });
      }
    }

    const guestName = isAgentMessage
      ? normalizeString(existingData.customer) || inviteName || "Unknown guest"
      : payload.contactName || inviteName || invitePhone || "Unknown guest";
    const agentName = isAgentMessage ? formatAdminName(adminSession, normalizeString(payload.contactName) || "Admin") : "";
    const customerName = guestName;
    const requestReason = isAgentMessage
      ? String(existingData.requestReason ?? "")
      : await buildSupportReason(currentMessage, customerName, existingThread);
    const nextThread = [
      ...existingThread,
      {
        role: isAgentMessage ? "agent" : "customer",
        message: currentMessage,
        createdAt: now.toISOString(),
      },
    ];

    const summaryTitle =
      String(existingData.summaryTitle ?? "").trim() ||
      (await buildSupportThreadTitle({
        message: currentMessage,
        question: existingQuestion || currentMessage,
        answer: existingAnswer,
        customerName,
        existingThread: nextThread,
      }));

    const nextHumanRequestedAt = isAgentMessage ? existingHumanRequestedAt : existingHumanRequestedAt ?? now;
    const nextHumanAcknowledgedAt = isAgentMessage ? existingHumanAcknowledgedAt ?? now : existingHumanAcknowledgedAt ?? null;
    const nextStatus = isAgentMessage ? "in progress" : existingStatus || "open";
    const nextCurrentAgent = isAgentMessage
      ? agentName || existingCurrentAgent || "Admin"
      : existingCurrentAgent || "Unassigned";
    const nextAssignedTo = isAgentMessage ? nextCurrentAgent || "Admin" : existingAssignedTo || "Unassigned";

    const nextPhoneNumber = isAgentMessage
      ? String(existingData.phoneNumber ?? invitePhone ?? "").trim()
      : authorizedInvite?.phoneNumber || invitePhone || "";
    const nextCustomerPhotoUrl = isAgentMessage
      ? existingData.customerPhotoUrl ?? invite?.profilePhotoUrl ?? null
      : customerPhotoUrl;
    const nextContactPhoneNumber = isAgentMessage
      ? String(existingData.contactPhoneNumber ?? nextPhoneNumber ?? "").trim()
      : authorizedInvite?.phoneNumber ?? String(existingData.contactPhoneNumber ?? "");

    const inquiryData = {
      inviteId: authorizedInvite?.id ?? String(existingData.inviteId ?? payload.ticketId ?? ""),
      customer: customerName,
      customerPhotoUrl: nextCustomerPhotoUrl,
      phoneNumber: nextPhoneNumber,
      inviteToken: authorizedInvite?.id ?? String(existingData.inviteToken ?? ""),
      contactPhoneNumber: nextContactPhoneNumber,
      question: existingQuestion || currentMessage,
      answer: isAgentMessage ? currentMessage : existingAnswer,
      status: nextStatus,
      currentAgent: nextCurrentAgent,
      assignedTo: nextAssignedTo,
      humanRequestedAt: nextHumanRequestedAt,
      humanAcknowledgedAt: nextHumanAcknowledgedAt,
      humanConnectionSmsSentAt: existingHumanConnectionSmsSentAt ?? null,
      humanTimeoutNoticeAt: existingHumanTimeoutNoticeAt ?? null,
      topic: "support",
      suggestedAction: "none",
      requestReason,
      ticketCode: existingTicketCode || createTicketCode(),
      summaryTitle,
      thread: nextThread,
      supportChatActiveAt: now,
      supportChatState: "active",
      updatedAt: now,
      createdAt: existingCreatedAt ?? now,
    };

    if (!docRef) {
      const created = await db.collection(SUPPORT_CHAT_COLLECTION).add(inquiryData);
      const inquiry = toInquiryItem(created.id, inquiryData);
      await maybeSendSupportSms({
        customerName,
        requestReason,
        wantsHumanSupport: payload.wantsHumanSupport,
        isNewTicket: true,
        existingHumanRequestedAt: null,
      });
      return json({
        ok: true,
        inquiry,
        ticketId: created.id,
        topic: "support",
        suggestedAction: "none",
      });
    }

    await docRef.set(inquiryData, { merge: true });
    const inquiry = toInquiryItem(payload.ticketId, inquiryData);
    if (isAgentMessage) {
      const targetPhoneNumber = String(nextPhoneNumber ?? "").replace(/\D/g, "");
      if (targetPhoneNumber) {
        try {
          await sendTextSms({
            to: targetPhoneNumber,
            message: buildCustomerReplySmsMessage(customerName),
          });
          if (!existingHumanConnectionSmsSentAt) {
            inquiryData.humanConnectionSmsSentAt = now;
          }
        } catch {
          // Best effort only.
        }
      }
    } else {
      await maybeSendSupportSms({
        customerName,
        requestReason,
        wantsHumanSupport: payload.wantsHumanSupport,
        isNewTicket: false,
        existingHumanRequestedAt,
      });
    }
    return json({
      ok: true,
      inquiry,
      ticketId: payload.ticketId,
      topic: "support",
      suggestedAction: "none",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save inquiry.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
