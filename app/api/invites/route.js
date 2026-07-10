import { NextResponse } from "next/server";

import { getDb } from "../../../lib/firestore";
import { parseInvitePayload, toInviteRequest } from "../../../lib/invites";
import { getInviteSettings } from "../../../lib/settings";

const COLLECTION = "invite_requests";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-key",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
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

async function findInviteDoc(db, inviteToken) {
  const safeToken = String(inviteToken ?? "").trim();

  if (!safeToken) {
    return null;
  }

  const directSnapshot = await db.collection(COLLECTION).doc(safeToken).get();
  if (directSnapshot.exists) {
    return directSnapshot.ref;
  }

  const querySnapshot = await db
    .collection(COLLECTION)
    .where("phoneNumber", "==", safeToken.replace(/\D/g, ""))
    .limit(1)
    .get();

  if (querySnapshot.empty) {
    return null;
  }

  return querySnapshot.docs[0].ref;
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

export async function PATCH(request) {
  try {
    const payload = await request.json();
    const inviteToken = String(payload?.inviteToken ?? "").trim();
    const rsvp = String(payload?.rsvp ?? "").trim();

    if (!inviteToken) {
      return json({ ok: false, error: "inviteToken is required." }, { status: 400 });
    }

    if (!["Going", "maybe", "not going"].includes(rsvp)) {
      return json({ ok: false, error: "Invalid RSVP value." }, { status: 400 });
    }

    const db = getDb();
    const docRef = await findInviteDoc(db, inviteToken);

    if (!docRef) {
      return json({ ok: false, error: "Invite not found." }, { status: 404 });
    }

    await docRef.set(
      {
        rsvp,
        updatedAt: new Date(),
      },
      { merge: true },
    );

    const snapshot = await docRef.get();
    return json({
      ok: true,
      user: toInviteRequest(snapshot.id, snapshot.data() ?? {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update RSVP.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
