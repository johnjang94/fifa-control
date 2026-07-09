import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { toInquiryItem } from "../../../../../lib/inquiry";

const COLLECTION = "guest_faq_inquiries";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
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
      updatedAt: new Date(),
    };

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
