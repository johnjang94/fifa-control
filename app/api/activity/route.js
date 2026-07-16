import { NextResponse } from "next/server";

import { getDb } from "../../../lib/firestore";
import { parseActivityPayload, toActivityLog } from "../../../lib/activity";
import { verifyAdminSession } from "../../../lib/admin";

const COLLECTION = "activity_logs";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-session-id",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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

export async function POST(request) {
  try {
    const payload = parseActivityPayload(await request.json());
    const doc = await getDb().collection(COLLECTION).add({
      ...payload,
      createdAt: new Date(),
    });

    return json({
      ok: true,
      id: doc.id,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save activity.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}

export async function GET(request) {
  const sessionCheck = await adminSessionMatches(request);
  if (!sessionCheck.ok) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const inviteToken = String(request.nextUrl.searchParams.get("inviteToken") ?? "").trim();
  const phoneNumber = String(request.nextUrl.searchParams.get("phoneNumber") ?? "").trim();

  const snapshot = await getDb()
    .collection(COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  const activities = snapshot.docs
    .map((doc) => toActivityLog(doc.id, doc.data()))
    .filter((activity) => {
      if (inviteToken && String(activity.inviteToken ?? "").trim() !== inviteToken) {
        return false;
      }

      if (phoneNumber && String(activity.phoneNumber ?? "").trim() !== phoneNumber) {
        return false;
      }

      return true;
    });

  return json({
    ok: true,
    activities,
  });
}
