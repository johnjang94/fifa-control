import { NextResponse } from "next/server";

import { getDb } from "../../../lib/firestore";
import { verifyAdminSession } from "../../../lib/admin";
import { getInviteSettings, setInviteCapacity } from "../../../lib/settings";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-session-id",
  "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
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

export async function GET(request) {
  const sessionCheck = await adminSessionMatches(request);
  if (!sessionCheck.ok) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getInviteSettings(getDb());

  return json({
    ok: true,
    ...settings,
  });
}

export async function PUT(request) {
  const sessionCheck = await adminSessionMatches(request);
  if (!sessionCheck.ok) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const settings = await setInviteCapacity(getDb(), payload.capacity);

  return json({
    ok: true,
    ...settings,
  });
}
