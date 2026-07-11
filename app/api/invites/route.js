import { NextResponse } from "next/server";

import { getDb } from "../../../lib/firestore";
import { deleteInviteAndRelatedInquiries, findInviteRef } from "../../../lib/invite-deletion";
import { parseInvitePayload, toInviteRequest } from "../../../lib/invites";
import { getInviteSettings } from "../../../lib/settings";

const COLLECTION = "invite_requests";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-key",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
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

async function generateUniqueBarcode(db) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const barcode = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
    const snapshot = await db
      .collection(COLLECTION)
      .where("barcode", "==", barcode)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return barcode;
    }
  }

  throw new Error("Unable to allocate a barcode. Please try again.");
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
    const db = getDb();
    const barcode = await generateUniqueBarcode(db);

    const doc = await db.collection(COLLECTION).add({
      ...payload,
      barcode,
      createdAt: new Date(),
      source: "guest-home",
      status: isFull ? "waitlist" : "confirmed",
    });

    return json({
      ok: true,
      id: doc.id,
      qrToken: doc.id,
      barcode,
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
    const docRef = await findInviteRef(db, inviteToken);

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

export async function DELETE(request) {
  if (!adminKeyMatches(request)) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const inviteToken = String(request.nextUrl.searchParams.get("inviteToken") ?? "").trim();
  if (!inviteToken) {
    return json({ ok: false, error: "inviteToken is required." }, { status: 400 });
  }

  try {
    const result = await deleteInviteAndRelatedInquiries(getDb(), inviteToken);
    if (!result) {
      return json({ ok: false, error: "Invite not found." }, { status: 404 });
    }

    return json({
      ok: true,
      user: result.invite,
      deletedInquiryCount: result.deletedInquiryCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete invite.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
