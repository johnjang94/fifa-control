import { NextResponse } from "next/server";

import { getDb } from "../../../../lib/firestore";
import {
  buildAutoReply,
  parseSupportPayload,
  toInquiryItem,
} from "../../../../lib/inquiry";
import { toInviteRequest } from "../../../../lib/invites";
import { sendSupportSms } from "../../../../lib/sms";

const COLLECTION = "guest_faq_inquiries";
const INVITE_COLLECTION = "invite_requests";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function json(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) },
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

  const snapshot = await getDb().collection(COLLECTION).doc(ticketId).get();
  if (!snapshot.exists) {
    return json({ ok: false, error: "Ticket not found." }, { status: 404 });
  }

  return json({
    ok: true,
    inquiry: toInquiryItem(snapshot.id, snapshot.data() ?? {}),
  });
}

async function lookupInvite(db, inviteToken) {
  const safeToken = String(inviteToken ?? "").trim();
  if (!safeToken) {
    return null;
  }

  const directSnapshot = await db.collection(INVITE_COLLECTION).doc(safeToken).get();
  if (directSnapshot.exists) {
    return toInviteRequest(directSnapshot.id, directSnapshot.data() ?? {});
  }

  const phoneNumber = safeToken.replace(/\D/g, "");
  const snapshot = await db
    .collection(INVITE_COLLECTION)
    .where("phoneNumber", "==", phoneNumber)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  return toInviteRequest(doc.id, doc.data());
}

export async function POST(request) {
  try {
    const payload = parseSupportPayload(await request.json());
    const db = getDb();
    const invite = await lookupInvite(db, payload.inviteToken);
    const inviteName = invite ? `${invite.firstName} ${invite.lastName}`.trim() : "";
    const invitePhone = invite?.phoneNumber || "";
    const customerName =
      payload.contactName ||
      inviteName ||
      invitePhone ||
      "이름 미확인";
    const customerPhotoUrl = invite?.profilePhotoUrl ?? null;
    const phoneNumber = payload.contactPhoneNumber || invitePhone || payload.inviteToken || "";

    let docRef = null;
    let existingThread = [];
    let existingQuestion = "";
    let existingStatus = "open";
    let existingCurrentAgent = "Unassigned";
    let existingAssignedTo = "Unassigned";
    let existingCreatedAt = null;
    let existingHumanRequestedAt = null;
    let existingHumanAcknowledgedAt = null;

    if (payload.ticketId) {
      docRef = db.collection(COLLECTION).doc(payload.ticketId);
      const snapshot = await docRef.get();
      if (snapshot.exists) {
        const data = snapshot.data() ?? {};
        existingThread = Array.isArray(data.thread) ? data.thread : [];
        existingQuestion = String(data.question ?? "");
        existingStatus = String(data.status ?? "open");
        existingCurrentAgent = String(data.currentAgent ?? "Unassigned");
        existingAssignedTo = String(data.assignedTo ?? "Unassigned");
        existingCreatedAt = data.createdAt ?? null;
        existingHumanRequestedAt = data.humanRequestedAt ?? null;
        existingHumanAcknowledgedAt = data.humanAcknowledgedAt ?? null;
      } else {
        docRef = null;
      }
    }

    const reply =
      payload.requestType === "food_request"
        ? {
            topic: "food_request_submission",
            answer: "Thanks. Your request has been sent to the host.",
            suggestedAction: "none",
          }
        : buildAutoReply(payload.message, customerName, existingThread);
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

    const inquiryData = {
      customer: customerName,
      customerPhotoUrl,
      phoneNumber,
      inviteToken: payload.inviteToken || phoneNumber,
      question: existingQuestion || currentMessage,
      answer: reply.answer,
      status: payload.wantsHumanSupport ? "human requested" : existingStatus || "open",
      currentAgent: existingCurrentAgent || "Unassigned",
      assignedTo: existingAssignedTo || "Unassigned",
      humanRequestedAt:
        existingHumanRequestedAt ?? (payload.wantsHumanSupport ? new Date() : null),
      humanAcknowledgedAt: existingHumanAcknowledgedAt ?? null,
      topic: reply.topic,
      suggestedAction: reply.suggestedAction,
      thread: nextThread,
      updatedAt: new Date(),
      createdAt: existingCreatedAt ?? new Date(),
    };

    if (!docRef) {
      const created = await db.collection(COLLECTION).add(inquiryData);
      const inquiry = toInquiryItem(created.id, inquiryData);
      await maybeSendSupportSms({
        customerName,
        requestType: payload.requestType,
        humanRequested: payload.wantsHumanSupport,
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
      customerName,
      requestType: payload.requestType,
      humanRequested: payload.wantsHumanSupport,
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

function buildSupportSmsMessage({ customerName, humanRequested, requestType }) {
  const displayName = customerName || "이름 미확인";
  if (requestType === "food_request") {
    return `host 알림: ${displayName} 님이 support 채널에서 음식 반입 요청을 보냈습니다.`;
  }

  if (humanRequested) {
    return `host 알림: ${displayName} 님이 support 채널에서 실 상담을 요청했습니다.`;
  }

  return `host 알림: ${displayName} 님이 support 채널에서 챗봇 상담 중입니다.`;
}

async function maybeSendSupportSms({
  customerName,
  requestType,
  humanRequested,
  isNewTicket,
  existingStatus,
  acknowledgedAt,
  humanRequestedAt,
}) {
  const hasHumanAlert = Boolean(humanRequestedAt);
  const shouldNotify =
    requestType === "food_request" ||
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
      }),
    );
  } catch {
    // SMS notifications are best effort only.
  }
}
