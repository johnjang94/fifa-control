import { NextResponse } from "next/server";

import { getDb } from "../../../../../../lib/firestore";
import { createAdminSession, verifyAdminOtpChallenge } from "../../../../../../lib/admin";

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
    const phoneNumber = String(payload?.phoneNumber ?? "").replace(/\D/g, "");
    const code = String(payload?.code ?? "").replace(/\D/g, "");

    if (phoneNumber.length !== 10) {
      return json({ ok: false, error: "Please enter a valid phone number." }, { status: 400 });
    }

    if (code.length !== 6) {
      return json({ ok: false, error: "Please enter the 6-digit code." }, { status: 400 });
    }

    const db = getDb();
    const verified = await verifyAdminOtpChallenge(db, phoneNumber, code);

    if (!verified.ok) {
      return json({ ok: false, error: verified.error ?? "Invalid verification code." }, { status: 401 });
    }

    const session = await createAdminSession(db, verified.admin);

    return json({
      ok: true,
      session,
      admin: verified.admin,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify code.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
