import { NextResponse } from "next/server";

import { getDb } from "../../../../lib/firestore";

const COLLECTION = "invite_requests";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
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
  const rawInviteToken = String(request.nextUrl.searchParams.get("inviteToken") ?? "").trim();
  const phoneNumber = rawInviteToken.replace(/\D/g, "");

  if (!rawInviteToken) {
    return json({ ok: false, error: "inviteToken is required." }, { status: 400 });
  }

  const db = getDb();
  const directSnapshot = await db.collection(COLLECTION).doc(rawInviteToken).get();
  let snapshot = directSnapshot.exists ? directSnapshot : null;

  if (!snapshot) {
    const phoneSnapshot = await db
      .collection(COLLECTION)
      .where("phoneNumber", "==", phoneNumber)
      .limit(1)
      .get();

    if (phoneSnapshot.empty) {
      return json({ ok: true, invite: null });
    }

    snapshot = phoneSnapshot.docs[0];
  }

  if (!snapshot.exists) {
    return json({ ok: true, invite: null });
  }

  const data = snapshot.data() ?? {};
  return json({
    ok: true,
    invite: {
      firstName: String(data.firstName ?? ""),
      lastName: String(data.lastName ?? ""),
      phoneNumber: String(data.phoneNumber ?? ""),
      profilePhotoUrl: typeof data.profilePhotoUrl === "string" ? data.profilePhotoUrl : "",
      rsvp: String(data.rsvp ?? "Going"),
    },
  });
}
