import { NextResponse } from "next/server";

import { getDb } from "../../../../../../lib/firestore";
import {
  buildAdminOtpMessage,
  createAdminOtpChallenge,
  findAdminByPhone,
} from "../../../../../../lib/admin";
import { sendTextSms } from "../../../../../../lib/sms";

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

    if (phoneNumber.length !== 10) {
      return json({ ok: false, error: "Please enter a valid 10-digit phone number." }, { status: 400 });
    }

    const db = getDb();
    const admin = await findAdminByPhone(db, phoneNumber);

    if (!admin) {
      return json({
        ok: true,
        delivered: false,
        message: "If this phone number is registered, a verification code has been sent.",
      });
    }

    const challenge = await createAdminOtpChallenge(db, admin);
    const result = await sendTextSms({
      to: challenge.phoneNumber,
      message: buildAdminOtpMessage(admin.firstName, challenge.code),
    });

    if (!result.ok) {
      await db.collection("admin_otp_challenges").doc(challenge.phoneNumber).delete().catch(() => {});
      return json(
        {
          ok: false,
          error: result.skipped
            ? "SMS is not configured on this server."
            : result.error ?? "Unable to send verification code.",
        },
        { status: 503 },
      );
    }

    return json({
      ok: true,
      delivered: true,
      message: "Verification code sent.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send verification code.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
