import { NextResponse } from "next/server";

import { getDb } from "../../../../lib/firestore";
import {
  buildAutoReply,
  buildSupportReason,
  buildSupportThreadTitle,
  createTicketCode,
  parseSupportPayload,
  toInquiryItem,
} from "../../../../lib/inquiry";
import { toInviteRequest } from "../../../../lib/invites";
import { sendSupportSms } from "../../../../lib/sms";
import { getAuthorizedInvite } from "../../../../lib/support-access";

const COLLECTION = "guest_faq_inquiries";
const INVITE_COLLECTION = "invite_requests";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-support-access-token",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function json(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...CORS_HEADERS, ...(init?.headers ?? {}) },
  });
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

  const snapshot = await db.collection(COLLECTION).doc(ticketId).get();
  if (!snapshot.exists) {
    return json({ ok: false, error: "Ticket not found." }, { status: 404 });
  }

  const data = snapshot.data() ?? {};
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
    inquiry: toInquiryItem(snapshot.id, data),
  });
}

export async function POST(request) {
  try {
    const payload = parseSupportPayload(await request.json());
    const db = getDb();
    const authorizedInvite = await getAuthorizedInvite(db, request);
    if (!authorizedInvite) {
      return json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const inviteSnapshot = await db.collection(INVITE_COLLECTION).doc(authorizedInvite.id).get();
    const invite = inviteSnapshot.exists ? toInviteRequest(inviteSnapshot.id, inviteSnapshot.data() ?? {}) : null;
    const inviteName = invite ? `${invite.firstName} ${invite.lastName}`.trim() : "";
    const invitePhone = invite?.phoneNumber || "";
    const customerName = payload.contactName || inviteName || invitePhone || "Unknown guest";
    const smsCustomerName =
      payload.contactName ||
      inviteName ||
      invitePhone ||
      authorizedInvite.phoneNumber ||
      "";
    const customerPhotoUrl = invite?.profilePhotoUrl ?? null;
    const phoneNumber = authorizedInvite.phoneNumber || invitePhone || "";

    let docRef = null;
    let existingThread = [];
    let existingQuestion = "";
    let existingStatus = "open";
    let existingCurrentAgent = "Unassigned";
    let existingAssignedTo = "Unassigned";
    let existingCreatedAt = null;
    let existingHumanRequestedAt = null;
    let existingHumanAcknowledgedAt = null;
    let existingHumanConnectionSmsSentAt = null;
    let existingTicketCode = "";

    if (payload.ticketId) {
      docRef = db.collection(COLLECTION).doc(payload.ticketId);
      const snapshot = await docRef.get();
      if (snapshot.exists) {
        const data = snapshot.data() ?? {};
        const ticketInviteId = String(data.inviteId ?? "").trim();
        const ticketPhoneNumber = String(data.phoneNumber ?? "").replace(/\D/g, "");
        if (ticketInviteId && ticketInviteId !== authorizedInvite.id) {
          return json({ ok: false, error: "Unauthorized" }, { status: 403 });
        }
        if (!ticketInviteId && ticketPhoneNumber && ticketPhoneNumber !== authorizedInvite.phoneNumber) {
          return json({ ok: false, error: "Unauthorized" }, { status: 403 });
        }
        existingThread = Array.isArray(data.thread) ? data.thread : [];
        existingQuestion = String(data.question ?? "");
        existingStatus = String(data.status ?? "open");
        existingCurrentAgent = String(data.currentAgent ?? "Unassigned");
        existingAssignedTo = String(data.assignedTo ?? "Unassigned");
        existingCreatedAt = data.createdAt ?? null;
        existingHumanRequestedAt = data.humanRequestedAt ?? null;
        existingHumanAcknowledgedAt = data.humanAcknowledgedAt ?? null;
        existingHumanConnectionSmsSentAt = data.humanConnectionSmsSentAt ?? null;
        existingTicketCode = String(data.ticketCode ?? "").trim();
      } else {
        docRef = null;
      }
    }

    const requestReason = payload.wantsHumanSupport
      ? await buildSupportReason(payload.message, customerName, existingThread)
      : "";

    const reply =
      payload.requestType === "food_request"
        ? {
            topic: "food_request_submission",
            answer: "Thanks. Your request has been sent to the host.",
            suggestedAction: "none",
          }
        : await buildAutoReply(payload.message, customerName, existingThread);
    const nextThread = [
      ...existingThread,
      {
        role: "customer",
        message: payload.message,
        createdAt: new Date().toISOString(),
      },
      {
        role: "assistant",
        message: reply.answer,
        createdAt: new Date().toISOString(),
      },
    ];
    const currentMessage = String(payload.message ?? "");
    const summaryTitle = await buildSupportThreadTitle({
      message: currentMessage,
      question: existingQuestion || currentMessage,
      answer: reply.answer,
      customerName,
      existingThread: nextThread,
    });

    const inquiryData = {
      inviteId: authorizedInvite.id,
      customer: customerName,
      customerPhotoUrl,
      phoneNumber,
      inviteToken: authorizedInvite.id,
      contactPhoneNumber: authorizedInvite.phoneNumber,
      question: existingQuestion || currentMessage,
      answer: reply.answer,
      status: payload.wantsHumanSupport ? "human requested" : existingStatus || "open",
      currentAgent: existingCurrentAgent || "Unassigned",
      assignedTo: existingAssignedTo || "Unassigned",
      humanRequestedAt:
        existingHumanRequestedAt ?? (payload.wantsHumanSupport ? new Date() : null),
      humanAcknowledgedAt: existingHumanAcknowledgedAt ?? null,
      humanConnectionSmsSentAt: existingHumanConnectionSmsSentAt ?? null,
      topic: reply.topic,
      suggestedAction: reply.suggestedAction,
      requestReason,
      ticketCode: existingTicketCode || createTicketCode(),
      summaryTitle,
      thread: nextThread,
      supportChatActiveAt: new Date(),
      supportChatState: "active",
      updatedAt: new Date(),
      createdAt: existingCreatedAt ?? new Date(),
    };

    if (!docRef) {
      const created = await db.collection(COLLECTION).add(inquiryData);
      const inquiry = toInquiryItem(created.id, inquiryData);
      await maybeSendSupportSms({
        customerName: smsCustomerName,
        requestType: payload.requestType,
        humanRequested: payload.wantsHumanSupport,
        requestReason,
        topic: reply.topic,
        suggestedAction: reply.suggestedAction,
        isNewTicket: true,
        existingStatus: "open",
        acknowledgedAt: null,
        humanRequestedAt: inquiryData.humanRequestedAt,
      });
      return json({
        ok: true,
        inquiry,
        ticketId: created.id,
        topic: reply.topic,
        suggestedAction: reply.suggestedAction,
      });
    }

    await docRef.set(inquiryData, { merge: true });
    const inquiry = toInquiryItem(payload.ticketId, inquiryData);
    await maybeSendSupportSms({
      customerName: smsCustomerName,
      requestType: payload.requestType,
      humanRequested: payload.wantsHumanSupport,
      requestReason,
      topic: reply.topic,
      suggestedAction: reply.suggestedAction,
      isNewTicket: false,
      existingStatus,
      acknowledgedAt: existingHumanAcknowledgedAt,
      humanRequestedAt: existingHumanRequestedAt,
    });
    return json({
      ok: true,
      inquiry,
      ticketId: payload.ticketId,
      topic: reply.topic,
      suggestedAction: reply.suggestedAction,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save inquiry.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}

function buildSupportSmsMessage({
  customerName,
  humanRequested,
  requestType,
  requestReason,
  topic,
  suggestedAction,
}) {
  const displayName = typeof customerName === "string" ? customerName.trim() : "";
  const subject = displayName ? `${displayName} ` : "";
  const reason = humanRequested && typeof requestReason === "string" ? requestReason.trim() : "";
  const reasonSuffix = reason ? ` Reason: ${reason.slice(0, 140)}` : "";

  if (
    requestType === "food_request" ||
    topic === "bring_food" ||
    suggestedAction === "food_request_confirmation" ||
    suggestedAction === "food_request_form"
  ) {
    return `Host alert: ${subject}requested to bring food, snacks, or drinks in the support channel.${reasonSuffix}`;
  }

  if (humanRequested) {
    return `Host alert: ${subject}requested a live conversation in the support channel.${reasonSuffix}`;
  }

  return `Host alert: ${subject}is chatting with the support bot.${reasonSuffix}`;
}

async function maybeSendSupportSms({
  customerName,
  requestType,
  humanRequested,
  requestReason,
  topic,
  suggestedAction,
  isNewTicket,
  existingStatus,
  acknowledgedAt,
  humanRequestedAt,
}) {
  const hasHumanAlert = Boolean(humanRequestedAt);
  const shouldNotify =
    requestType === "food_request" ||
    topic === "bring_food" ||
    suggestedAction === "food_request_confirmation" ||
    suggestedAction === "food_request_form" ||
    isNewTicket ||
    (humanRequested && !acknowledgedAt && !hasHumanAlert && existingStatus !== "human requested");

  if (!shouldNotify) {
    return;
  }

  try {
    await sendSupportSms(
      buildSupportSmsMessage({
        customerName,
        requestType,
        humanRequested,
        requestReason,
        topic,
        suggestedAction,
      }),
    );
  } catch {
    // SMS notifications are best effort only.
  }
}
