import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { toInquiryItem } from "../../../../../lib/inquiry";
import { getAuthorizedInvite } from "../../../../../lib/support-access";
import { SUPPORT_CHAT_COLLECTION } from "../../../../../lib/support-chat-inquiries";

const HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

function encodeEvent(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function loadInquiry(db, ticketId) {
  const primarySnapshot = await db.collection(SUPPORT_CHAT_COLLECTION).doc(ticketId).get();
  if (primarySnapshot.exists) {
    return toInquiryItem(primarySnapshot.id, primarySnapshot.data() ?? {});
  }

  return null;
}

export async function GET(request) {
  const ticketId = String(request.nextUrl.searchParams.get("ticketId") ?? "").trim();
  if (!ticketId) {
    return NextResponse.json({ ok: false, error: "ticketId is required." }, { status: 400 });
  }

  const db = getDb();
  const authorizedInvite = await getAuthorizedInvite(db, request);
  if (!authorizedInvite) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let lastSignature = "";
      let timerId = null;
      let heartbeatId = null;

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        if (timerId) {
          clearInterval(timerId);
        }
        if (heartbeatId) {
          clearInterval(heartbeatId);
        }
        controller.close();
      };

      const push = async () => {
        if (closed) {
          return;
        }

        try {
          const inquiry = await loadInquiry(db, ticketId);
          if (!inquiry) {
            return;
          }

          const signature = JSON.stringify([
            inquiry.id,
            inquiry.updatedAt,
            inquiry.humanAcknowledgedAt,
            inquiry.humanConnectionSmsSentAt,
            inquiry.answer,
            inquiry.thread?.length ?? 0,
          ]);

          if (signature === lastSignature) {
            return;
          }

          const ticketInviteId = String(inquiry.inviteId ?? "").trim();
          const ticketPhoneNumber = String(inquiry.phoneNumber ?? "").replace(/\D/g, "");
          if (ticketInviteId && ticketInviteId !== authorizedInvite.id) {
            controller.enqueue(
              new TextEncoder().encode(
                encodeEvent({ ok: false, error: "Unauthorized" }),
              ),
            );
            close();
            return;
          }
          if (!ticketInviteId && ticketPhoneNumber && ticketPhoneNumber !== authorizedInvite.phoneNumber) {
            controller.enqueue(
              new TextEncoder().encode(
                encodeEvent({ ok: false, error: "Unauthorized" }),
              ),
            );
            close();
            return;
          }

          lastSignature = signature;
          controller.enqueue(new TextEncoder().encode(encodeEvent({ ok: true, inquiry })));
        } catch (error) {
          controller.enqueue(
            new TextEncoder().encode(
              encodeEvent({
                ok: false,
                error: error instanceof Error ? error.message : "Unable to load inquiry.",
              }),
            ),
          );
        }
      };

      timerId = setInterval(() => {
        void push();
      }, 2000);

      heartbeatId = setInterval(() => {
        if (!closed) {
          controller.enqueue(new TextEncoder().encode(": keep-alive\n\n"));
        }
      }, 15000);

      request.signal.addEventListener("abort", close, { once: true });

      void push();
    },
    cancel() {
      // Controller cleanup happens via abort.
    },
  });

  return new Response(stream, { headers: HEADERS });
}
