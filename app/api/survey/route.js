import { NextResponse } from "next/server";

import { getDb } from "../../../lib/firestore";
import { toInviteRequest } from "../../../lib/invites";

const COLLECTION = "invite_requests";
const ALLOWED_SOURCES = new Set(["Friends", "LinkedIn", "Eventbrite", "Instagram", "X"]);
const ALLOWED_RESIDENT_VALUES = new Set(["Yes", "No"]);
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function json(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) },
  });
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function findInviteDoc(db, inviteToken) {
  const safeToken = normalizeString(inviteToken);
  if (!safeToken) {
    return null;
  }

  const directSnapshot = await db.collection(COLLECTION).doc(safeToken).get();
  if (directSnapshot.exists) {
    return directSnapshot.ref;
  }

  const phoneNumber = safeToken.replace(/\D/g, "");
  if (!phoneNumber) {
    return null;
  }

  const phoneSnapshot = await db
    .collection(COLLECTION)
    .where("phoneNumber", "==", phoneNumber)
    .limit(1)
    .get();

  if (phoneSnapshot.empty) {
    return null;
  }

  return phoneSnapshot.docs[0].ref;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const inviteToken = normalizeString(payload?.inviteToken);
    const howDidYouKnow = normalizeString(payload?.howDidYouKnow);
    const referredBy = normalizeString(payload?.referredBy);
    const dietaryRestrictions = normalizeString(payload?.dietaryRestrictions);
    const resident = normalizeString(payload?.resident);

    if (!inviteToken) {
      return json({ ok: false, error: "inviteToken is required." }, { status: 400 });
    }

    if (!ALLOWED_SOURCES.has(howDidYouKnow)) {
      return json({ ok: false, error: "Please choose how you heard about the event." }, { status: 400 });
    }

    if (howDidYouKnow === "Friends" && !referredBy) {
      return json({ ok: false, error: "Please tell us who referred you." }, { status: 400 });
    }

    if (!dietaryRestrictions) {
      return json({ ok: false, error: "Please share your dietary restrictions." }, { status: 400 });
    }

    if (!ALLOWED_RESIDENT_VALUES.has(resident)) {
      return json({ ok: false, error: "Please answer whether you live in the building." }, { status: 400 });
    }

    const db = getDb();
    const docRef = await findInviteDoc(db, inviteToken);

    if (!docRef) {
      return json({ ok: false, error: "Invite not found." }, { status: 404 });
    }

    const survey = {
      howDidYouKnow,
      referredBy: howDidYouKnow === "Friends" ? referredBy : "",
      dietaryRestrictions,
      resident,
      submittedAt: new Date(),
    };

    await docRef.set(
      {
        survey,
        surveyCompletedAt: new Date(),
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
    const message = error instanceof Error ? error.message : "Unable to save survey.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
