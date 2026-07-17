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

function parseCursor(rawCursor) {
  const cursorValue = String(rawCursor ?? "").trim();
  if (!cursorValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(cursorValue);
    const createdAt = String(parsed?.createdAt ?? "").trim();
    const id = String(parsed?.id ?? "").trim();

    if (!createdAt || !id) {
      return null;
    }

    return { createdAt, id };
  } catch {
    return null;
  }
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
  const cursor = parseCursor(request.nextUrl.searchParams.get("cursor"));
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500) : 200;

  if (request.nextUrl.searchParams.has("cursor") && !cursor) {
    return json({ ok: false, error: "Invalid cursor." }, { status: 400 });
  }

  let query = getDb().collection(COLLECTION).orderBy("createdAt", "desc");

  if (cursor) {
    query = query.startAfter(new Date(cursor.createdAt));
  }

  const snapshot = await query.limit(limit).get();

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

  const lastDoc = snapshot.docs[snapshot.docs.length - 1];
  const nextCursor = lastDoc
    ? {
        createdAt: toActivityLog(lastDoc.id, lastDoc.data()).createdAt,
        id: lastDoc.id,
      }
    : null;

  return json({
    ok: true,
    activities,
    nextCursor: snapshot.size === limit && lastDoc ? nextCursor : null,
  });
}
