import { NextResponse } from "next/server";

import { getDb } from "../../../lib/firestore";
import { toInviteRequest } from "../../../lib/invites";

const COLLECTION = "invite_requests";
const ALLOWED_INTERESTS = new Set([
  "I can bring corn and mushroom",
  "I can bring some beverages",
  "I would like to bring some snack to share with others",
  "I would like to bring some card deck for entertainment",
]);
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
  const candidate = normalizeString(inviteToken);

  if (!candidate) {
    return null;
  }

  const directSnapshot = await db.collection(COLLECTION).doc(candidate).get();
  if (directSnapshot.exists) {
    return directSnapshot.ref;
  }

  return null;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const inviteToken = normalizeString(payload?.inviteToken);
    const interests = Array.isArray(payload?.interests) ? payload.interests : [];
    const normalizedInterests = Array.from(
      new Set(interests.map((value) => normalizeString(value)).filter(Boolean)),
    ).filter((value) => ALLOWED_INTERESTS.has(value));

    if (!inviteToken) {
      return json({ ok: false, error: "inviteToken is required." }, { status: 400 });
    }

    if (normalizedInterests.length === 0) {
      return json({ ok: false, error: "Please select at least one item to bring." }, { status: 400 });
    }

    if (normalizedInterests.length > 2) {
      return json({ ok: false, error: "Please choose up to 2 items." }, { status: 400 });
    }

    const db = getDb();
    const docRef = await findInviteDoc(db, inviteToken);

    if (!docRef) {
      return json({ ok: false, error: "Invite not found." }, { status: 404 });
    }

    const volunteerApplication = {
      interests: normalizedInterests,
      submittedAt: new Date(),
    };

    await docRef.set(
      {
        volunteerApplication,
        volunteerApplicationCompletedAt: new Date(),
        updatedAt: new Date(),
      },
      { merge: true },
    );

    const refreshedSnapshot = await docRef.get();
    return json({
      ok: true,
      user: toInviteRequest(refreshedSnapshot.id, refreshedSnapshot.data() ?? {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save volunteer application.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
