import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { getAuthorizedInvite } from "../../../../../lib/support-access";
import { maybeAppendHumanTimeoutNotice } from "../../../../../lib/human-response";

const COLLECTION = "guest_faq_inquiries";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-support-access-token",
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
    const payload = await request.json();
    const ticketId = typeof payload?.ticketId === "string" ? payload.ticketId.trim() : "";
    const state = typeof payload?.state === "string" ? payload.state.trim().toLowerCase() : "active";

    if (!ticketId) {
      return json({ ok: false, error: "ticketId is required." }, { status: 400 });
    }

    const db = getDb();
    const authorizedInvite = await getAuthorizedInvite(db, request);
    if (!authorizedInvite) {
      return json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const docRef = db.collection(COLLECTION).doc(ticketId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      return json({ ok: false, error: "Ticket not found." }, { status: 404 });
    }

    const data = snapshot.data() ?? {};
    const ticketInviteId = String(data.inviteId ?? "").trim();
    const ticketPhoneNumber = String(data.phoneNumber ?? "").replace(/\D/g, "");
    if (ticketInviteId && ticketInviteId !== authorizedInvite.id) {
      return json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }
    if (!ticketInviteId && ticketPhoneNumber && ticketPhoneNumber !== authorizedInvite.phoneNumber) {
      return json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    const now = new Date();
    const timeoutCheck = maybeAppendHumanTimeoutNotice(data, now);
    const sourceData = timeoutCheck.appended ? timeoutCheck.data : data;
    const nextData =
      state === "inactive"
        ? {
            ...sourceData,
            supportChatState: "inactive",
            supportChatInactiveAt: now,
            updatedAt: now,
          }
        : {
            ...sourceData,
            supportChatState: "active",
            supportChatActiveAt: now,
            supportChatReadAt: now,
            supportChatInactiveAt: null,
            updatedAt: now,
          };

    await docRef.set(nextData, { merge: true });

    return json({
      ok: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update support presence.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
