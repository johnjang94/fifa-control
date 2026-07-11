import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/firestore";
import { deleteInviteAndRelatedInquiries } from "../../../../lib/invite-deletion";
import { toInviteRequest } from "../../../../lib/invites";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-key",
  "Access-Control-Allow-Methods": "GET,DELETE,OPTIONS",
};

function json(body, init) {
  return NextResponse.json(body, { ...init, headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) } });
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

export async function DELETE(request) {
  if (!adminKeyMatches(request)) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!token.trim()) {
    return json({ ok: false, error: "token is required." }, { status: 400 });
  }

  try {
    const result = await deleteInviteAndRelatedInquiries(getDb(), token);
    if (!result) {
      return json({ ok: false, error: "User not found." }, { status: 404 });
    }

    return json({
      ok: true,
      user: result.invite,
      deletedInquiryCount: result.deletedInquiryCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete user.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
