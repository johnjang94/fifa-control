import { NextResponse } from "next/server";

import { getDb } from "../../../../../lib/firestore";
import { verifyAdminSession } from "../../../../../lib/admin";
import { listAdminInquiries } from "../../../../../lib/admin-inquiries";

const HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

function encodeEvent(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function validateSession(sessionId) {
  const safeSessionId = String(sessionId ?? "").trim();
  if (!safeSessionId) {
    return false;
  }

  const result = await verifyAdminSession(getDb(), safeSessionId);
  return Boolean(result.ok);
}

export async function GET(request) {
  const sessionId = request.nextUrl.searchParams.get("sessionId") ?? "";
  const isAuthorized = await validateSession(sessionId);
  if (!isAuthorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let lastSignature = "";

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
          const inquiries = await listAdminInquiries(getDb(), { limit: 100 });
          const signature = JSON.stringify(
            inquiries.map((item) => [item.id, item.updatedAt, item.humanAcknowledgedAt, item.answer, item.thread?.length ?? 0]),
          );

          if (signature === lastSignature) {
            return;
          }

          lastSignature = signature;
          controller.enqueue(new TextEncoder().encode(encodeEvent({ ok: true, inquiries })));
        } catch (error) {
          controller.enqueue(
            new TextEncoder().encode(
              encodeEvent({
                ok: false,
                error: error instanceof Error ? error.message : "Unable to load inquiries.",
              }),
            ),
          );
        }
      };

      const timerId = setInterval(() => {
        void push();
      }, 2000);

      const heartbeatId = setInterval(() => {
        if (!closed) {
          controller.enqueue(new TextEncoder().encode(": keep-alive\n\n"));
        }
      }, 15000);

      request.signal.addEventListener("abort", close, { once: true });

      controller.enqueue(new TextEncoder().encode(encodeEvent({ ok: true, initial: true })));
      void push();
    },
    cancel() {
      // Controller cleanup happens via abort.
    },
  });

  return new Response(stream, { headers: HEADERS });
}
