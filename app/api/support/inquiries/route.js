import { NextResponse } from "next/server";

import { getDb } from "../../../../lib/firestore";
import {
  buildSupportThread,
  parseSupportPayload,
  toInquiryItem,
} from "../../../../lib/inquiry";
import { toInviteRequest } from "../../../../lib/invites";

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
  if (!inviteToken) {
    return null;
  }

  const snapshot = await db
    .collection(INVITE_COLLECTION)
    .where("phoneNumber", "==", inviteToken)
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
    const customerName =
      invite ? `${invite.firstName} ${invite.lastName}`.trim() : "Guest";
    const customerPhotoUrl = invite?.profilePhotoUrl ?? null;
    const phoneNumber = invite?.phoneNumber ?? payload.inviteToken ?? "";

    let docRef = null;
    let existingThread = [];
    let existingQuestion = "";
    let existingStatus = "open";
    let existingCurrentAgent = "Unassigned";
    let existingAssignedTo = "Unassigned";
    let existingCreatedAt = null;

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
      } else {
        docRef = null;
      }
    }

    const nextThread = buildSupportThread({
      existingThread,
      message: payload.message,
      customerName,
    });
    const currentMessage = String(payload.message ?? "");

    const inquiryData = {
      customer: customerName,
      customerPhotoUrl,
      phoneNumber,
      inviteToken: payload.inviteToken || phoneNumber,
      question: existingQuestion || currentMessage,
      answer: nextThread.filter((line) => line.role === "assistant").at(-1)?.message ?? "",
      status: existingStatus || "open",
      currentAgent: existingCurrentAgent || "Unassigned",
      assignedTo: existingAssignedTo || "Unassigned",
      thread: nextThread,
      updatedAt: new Date(),
      createdAt: existingCreatedAt ?? new Date(),
    };

    if (!docRef) {
      const created = await db.collection(COLLECTION).add(inquiryData);
      const inquiry = toInquiryItem(created.id, inquiryData);
      return json({ ok: true, inquiry, ticketId: created.id });
    }

    await docRef.set(inquiryData, { merge: true });
    const inquiry = toInquiryItem(payload.ticketId, inquiryData);
    return json({ ok: true, inquiry, ticketId: payload.ticketId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save inquiry.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
