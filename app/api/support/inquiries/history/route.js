import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { toInviteRequest } from "../../../../../lib/invites";
import { toInquiryItem } from "../../../../../lib/inquiry";

const INVITE_COLLECTION = "invite_requests";
const INQUIRY_COLLECTION = "guest_faq_inquiries";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
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

async function lookupInvitePhone(db, inviteToken) {
  const safeToken = String(inviteToken ?? "").trim();
  if (!safeToken) {
    return "";
  }

  const directSnapshot = await db.collection(INVITE_COLLECTION).doc(safeToken).get();
  if (directSnapshot.exists) {
    const invite = toInviteRequest(directSnapshot.id, directSnapshot.data() ?? {});
    return invite.phoneNumber;
  }

  return safeToken.replace(/\D/g, "");
}

export async function GET(request) {
  try {
    const inviteToken = String(request.nextUrl.searchParams.get("inviteToken") ?? "").trim();
    if (!inviteToken) {
      return json({ ok: false, error: "inviteToken is required." }, { status: 400 });
    }

    const db = getDb();
    const phoneNumber = await lookupInvitePhone(db, inviteToken);

    if (!phoneNumber) {
      return json({ ok: true, inquiries: [] });
    }

    const snapshot = await db
      .collection(INQUIRY_COLLECTION)
      .where("phoneNumber", "==", phoneNumber)
      .limit(50)
      .get();

    const inquiries = snapshot.docs
      .map((doc) => toInquiryItem(doc.id, doc.data() ?? {}))
      .sort((a, b) => {
        const aTime = new Date(a.createdAt).getTime() || 0;
        const bTime = new Date(b.createdAt).getTime() || 0;
        return bTime - aTime;
      })
      .slice(0, 25);

    return json({
      ok: true,
      inquiries,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load chat history.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
