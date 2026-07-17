import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { toInviteRequest } from "../../../../../lib/invites";
import { createSupportAccessToken } from "../../../../../lib/support-access";

const COLLECTION = "invite_requests";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function json(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...CORS_HEADERS, ...(init?.headers ?? {}) },
  });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const barcode = String(payload?.barcode ?? "").trim();

    if (!/^\d{5}$/.test(barcode)) {
      return json({ ok: false, error: "Please enter the 5-digit barcode." }, { status: 400 });
    }

    const db = getDb();
    const snapshot = await db
      .collection(COLLECTION)
      .where("barcode", "==", barcode)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return json({ ok: false, error: "Barcode not found." }, { status: 404 });
    }

    const invite = toInviteRequest(snapshot.docs[0].id, snapshot.docs[0].data() ?? {});

    return json({
      ok: true,
      inviteToken: invite.id,
      supportAccessToken: createSupportAccessToken(invite),
      invite,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to log in with barcode.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
