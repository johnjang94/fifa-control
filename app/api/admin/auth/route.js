import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/firestore";
import { createAdminSession, parseAdminAuthPayload, verifyAdminIdentity } from "../../../../lib/admin";

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

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request) {
  try {
    const payload = parseAdminAuthPayload(await request.json());
    const db = getDb();
    const identity = await verifyAdminIdentity(db, payload);

    if (!identity.ok) {
      return json(
        { ok: false, error: identity.error ?? "Unauthorized" },
        { status: 401 },
      );
    }

    const session = await createAdminSession(db, payload);
    return json({ ok: true, session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
