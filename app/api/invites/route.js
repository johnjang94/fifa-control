import { NextResponse } from "next/server";

import { getDb } from "../../../lib/firestore";
import { parseInvitePayload, toInviteRequest } from "../../../lib/invites";
import { getInviteSettings } from "../../../lib/settings";

const COLLECTION = "invite_requests";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-key",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function json(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...CORS_HEADERS,
      ...(init?.headers ?? {}),
    },
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

async function getInviteState() {
  const db = getDb();
  const [snapshot, settings] = await Promise.all([
    db.collection(COLLECTION).get(),
    getInviteSettings(db),
  ]);
  const capacity = settings.capacity;
  const inviteCount = snapshot.size;
  const isFull = capacity !== null ? inviteCount >= capacity : false;

  return { inviteCount, capacity, isFull, snapshot };
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const payload = await parseInvitePayload(formData);
    const { isFull } = await getInviteState();

    const doc = await getDb().collection(COLLECTION).add({
      ...payload,
      createdAt: new Date(),
      source: "guest-home",
      status: isFull ? "waitlist" : "confirmed",
    });

    return json({
      ok: true,
      id: doc.id,
      qrToken: doc.id,
      isWaitlist: isFull,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save invite request.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}

export async function GET(request) {
  const { inviteCount, capacity, isFull, snapshot } = await getInviteState();

  if (!adminKeyMatches(request)) {
    return json({
      ok: true,
      inviteCount,
      capacity,
      isFull,
    });
  }

  return json({
    ok: true,
    inviteCount,
    capacity,
    isFull,
    invites: snapshot.docs
      .slice()
      .sort((a, b) => {
        const aTime = a.data().createdAt?.toMillis?.() ?? 0;
        const bTime = b.data().createdAt?.toMillis?.() ?? 0;
        return bTime - aTime;
      })
      .slice(0, 100)
      .map((doc) => toInviteRequest(doc.id, doc.data())),
  });
}
