import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { verifyAdminSession } from "../../../../../lib/admin";
import { SUPPORT_CHAT_COLLECTION } from "../../../../../lib/support-chat-inquiries";

const INVITE_COLLECTION = "invite_requests";
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

async function getInviteSnapshotsById(db, inviteIds) {
  const uniqueIds = [...new Set(inviteIds)].filter(Boolean);
  const found = new Map();

  for (let index = 0; index < uniqueIds.length; index += 10) {
    const chunk = uniqueIds.slice(index, index + 10);
    const refs = chunk.map((id) => db.collection(INVITE_COLLECTION).doc(id));
    const snapshots = await db.getAll(...refs);

    for (const snapshot of snapshots) {
      if (snapshot.exists) {
        found.set(snapshot.id, snapshot.data() ?? {});
      }
    }
  }

  return found;
}

function normalizePhoneNumber(value) {
  return typeof value === "string" ? value.trim().replace(/\D/g, "") : "";
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
    const snapshot = await db.collection(SUPPORT_CHAT_COLLECTION).orderBy("createdAt", "desc").limit(1000).get();
    const inquiries = snapshot.docs.map((doc) => ({
      id: `${doc.ref.parent.id}:${doc.id}`,
      ref: doc.ref,
      data: doc.data() ?? {},
    }));

    const inviteIds = inquiries
      .map((item) => String(item.data.inviteId ?? "").trim())
      .filter(Boolean);
    const inviteSnapshots = await getInviteSnapshotsById(db, inviteIds);
    const invitePhoneNumbers = new Set(
      [...inviteSnapshots.values()].map((invite) => normalizePhoneNumber(invite.phoneNumber)).filter(Boolean),
    );

    const deletions = [];

    for (const inquiry of inquiries) {
      const inviteId = String(inquiry.data.inviteId ?? "").trim();
      const inquiryPhoneNumber = normalizePhoneNumber(inquiry.data.phoneNumber);

      if (inviteId) {
        if (!inviteSnapshots.has(inviteId)) {
          deletions.push(inquiry.ref.delete());
        }
        continue;
      }

      if (inquiryPhoneNumber && invitePhoneNumbers.has(inquiryPhoneNumber)) {
        continue;
      }

      deletions.push(inquiry.ref.delete());
    }

    await Promise.all(deletions);

    return json({
      ok: true,
      scannedInquiries: inquiries.length,
      deletedInquiries: deletions.length,
      matchedInvites: inviteSnapshots.size,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reconcile support data.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
