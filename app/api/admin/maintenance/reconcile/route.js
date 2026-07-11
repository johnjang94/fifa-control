import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";

const INVITE_COLLECTION = "invite_requests";
const INQUIRY_COLLECTION = "guest_faq_inquiries";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const MAX_INQUIRIES = 1000;

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
  if (!adminKeyMatches(request)) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const snapshot = await db
      .collection(INQUIRY_COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(MAX_INQUIRIES)
      .get();

    const inquiries = snapshot.docs.map((doc) => ({
      id: doc.id,
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
