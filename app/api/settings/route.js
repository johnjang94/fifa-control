import { NextResponse } from "next/server";

import { getDb } from "../../../lib/firestore";
import { getInviteSettings, setInviteCapacity } from "../../../lib/settings";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-key",
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

function adminKeyMatches(request) {
  const expected = process.env.ADMIN_ACCESS_KEY;
  if (!expected) {
    return true;
  }

  const provided = request.headers.get("x-admin-key") ?? "";
  return provided === expected;
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(request) {
  if (!adminKeyMatches(request)) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getInviteSettings(getDb());

  return json({
    ok: true,
    ...settings,
  });
}

export async function PUT(request) {
  if (!adminKeyMatches(request)) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const settings = await setInviteCapacity(getDb(), payload.capacity);

  return json({
    ok: true,
    ...settings,
  });
}
