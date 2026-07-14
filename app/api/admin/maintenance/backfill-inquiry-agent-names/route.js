import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { toInquiryItem } from "../../../../../lib/inquiry";
import { verifyAdminSession } from "../../../../../lib/admin";
import {
  LEGACY_SUPPORT_CHAT_COLLECTION,
  SUPPORT_CHAT_COLLECTION,
} from "../../../../../lib/support-chat-inquiries";

const COLLECTIONS = [SUPPORT_CHAT_COLLECTION, LEGACY_SUPPORT_CHAT_COLLECTION];
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-session-id",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function json(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) },
  });
}

function normalizeAgentName(value) {
  const name = String(value ?? "").trim();
  const lower = name.toLowerCase();
  if (!name || lower === "admin" || lower === "unassigned") {
    return "";
  }

  return name;
}

async function resolveTargetAgentName(db, request, payload) {
  const explicitName = normalizeAgentName(payload?.agentName);
  if (explicitName) {
    return explicitName;
  }

  const sessionId = String(request.headers.get("x-admin-session-id") ?? "").trim();
  if (!sessionId) {
    return "";
  }

  const sessionCheck = await verifyAdminSession(db, sessionId);
  if (!sessionCheck.ok) {
    return "";
  }

  const session = sessionCheck.session ?? {};
  return normalizeAgentName([session.firstName, session.lastName].filter(Boolean).join(" ")) || "";
}

function hasAgentPlaceholder(inquiry) {
  const currentAgent = normalizeAgentName(inquiry.currentAgent);
  const assignedTo = normalizeAgentName(inquiry.assignedTo);
  return !currentAgent || !assignedTo;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request) {
  const db = getDb();
  const sessionId = String(request.headers.get("x-admin-session-id") ?? "").trim();
  if (!sessionId) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const sessionCheck = await verifyAdminSession(db, sessionId);
  if (!sessionCheck.ok) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await request.json().catch(() => ({}));
    const targetAgentName = await resolveTargetAgentName(db, request, payload);

    if (!targetAgentName) {
      return json(
        {
          ok: false,
          error: "agentName or a valid admin session is required.",
        },
        { status: 400 },
      );
    }

    const snapshots = await Promise.all(COLLECTIONS.map((collection) => db.collection(collection).get()));
    const candidates = snapshots
      .flatMap((snapshot) =>
        snapshot.docs.map((doc) => ({
          id: doc.id,
          ref: doc.ref,
          data: doc.data() ?? {},
        })),
      )
      .filter((item) => hasAgentPlaceholder(item.data));

    let updatedCount = 0;

    for (const item of candidates) {
      const nextData = {
        ...item.data,
        currentAgent: targetAgentName,
        assignedTo: targetAgentName,
        updatedAt: new Date(),
      };

      await item.ref.set(nextData, { merge: true });
      updatedCount += 1;
    }

    const sample = candidates.slice(0, 10).map((item) => toInquiryItem(item.id, {
      ...item.data,
      currentAgent: targetAgentName,
      assignedTo: targetAgentName,
    }));

    return json({
      ok: true,
      targetAgentName,
      scannedCount: candidates.length,
      updatedCount,
      sample,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to backfill inquiry agent names.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
