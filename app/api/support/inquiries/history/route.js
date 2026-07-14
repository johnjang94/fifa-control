import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { toInquiryItem } from "../../../../../lib/inquiry";
import { getAuthorizedInvite } from "../../../../../lib/support-access";
import { SUPPORT_CHAT_COLLECTION } from "../../../../../lib/support-chat-inquiries";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-support-access-token",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
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

export async function GET(request) {
  try {
    const db = getDb();
    const authorizedInvite = await getAuthorizedInvite(db, request);

    if (!authorizedInvite) {
      return json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const snapshot = await db
      .collection(SUPPORT_CHAT_COLLECTION)
      .where("inviteId", "==", authorizedInvite.id)
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
