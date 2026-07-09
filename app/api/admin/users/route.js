import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/firestore";
import { toInviteRequest } from "../../../../lib/invites";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-key",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
};

function json(body, init) {
  return NextResponse.json(body, { ...init, headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) } });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (token) {
    const snapshot = await getDb().collection("invite_requests").doc(token).get();
    if (!snapshot.exists) {
      return json({ ok: false, error: "User not found." }, { status: 404 });
    }

    return json({
      ok: true,
      user: toInviteRequest(snapshot.id, snapshot.data() ?? {}),
    });
  }

  const days = Number(request.nextUrl.searchParams.get("days") ?? "");
  const snapshot = await getDb().collection("invite_requests").get();
  const now = Date.now();
  const lowerBound = Number.isFinite(days) && days > 0 ? now - days * 24 * 60 * 60 * 1000 : null;
  const users = snapshot.docs
    .map((doc) => toInviteRequest(doc.id, doc.data()))
    .filter((user) => {
      if (!lowerBound) return true;
      return new Date(user.createdAt).getTime() >= lowerBound;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return json({ ok: true, users });
}
