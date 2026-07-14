import { NextResponse } from "next/server";

import { getDb } from "../../../../lib/firestore";
import { verifyAdminSession } from "../../../../lib/admin";
import { isUploadableProfilePhoto } from "../../../../lib/storage";
import { setInvitePhoto } from "../../../../lib/settings";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-session-id",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
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

async function adminSessionMatches(request) {
  const sessionId = String(request.headers.get("x-admin-session-id") ?? "").trim();
  if (!sessionId) {
    return { ok: false };
  }

  return verifyAdminSession(getDb(), sessionId);
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(request) {
  const sessionCheck = await adminSessionMatches(request);
  if (!sessionCheck.ok) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const photo =
    formData.get("photo") ?? formData.get("bannerPhoto") ?? formData.get("file");

  if (!isUploadableProfilePhoto(photo)) {
    return json({ ok: false, error: "Please upload a JPG, PNG, or WebP photo." }, { status: 400 });
  }

  const settings = await setInvitePhoto(getDb(), "bannerPhoto", photo);

  return json({
    ok: true,
    ...settings,
  });
}
