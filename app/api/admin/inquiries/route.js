import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/firestore";
import { verifyAdminSession } from "../../../../lib/admin";
import { listAdminInquiries } from "../../../../lib/admin-inquiries";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-session-id",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
};

function json(body, init) {
  return NextResponse.json(body, { ...init, headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) } });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

async function adminSessionMatches(request) {
  const sessionId = String(request.headers.get("x-admin-session-id") ?? "").trim();
  if (!sessionId) {
    return { ok: false };
  }

  return verifyAdminSession(getDb(), sessionId);
}

export async function GET(request) {
  const sessionCheck = await adminSessionMatches(request);
  if (!sessionCheck.ok) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return json({
    ok: true,
    inquiries: await listAdminInquiries(getDb(), { limit: 100 }),
  });
}
