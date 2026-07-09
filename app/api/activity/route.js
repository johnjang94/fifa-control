import { NextResponse } from "next/server";

import { getDb } from "../../../lib/firestore";
import { parseActivityPayload, toActivityLog } from "../../../lib/activity";

const COLLECTION = "activity_logs";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-key",
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

function adminKeyMatches(request) {
  const expected = process.env.ADMIN_ACCESS_KEY;
  if (!expected) {
    return true;
  }

  const provided = request.headers.get("x-admin-key") ?? "";
  return provided === expected;
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
  if (!adminKeyMatches(request)) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await getDb()
    .collection(COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  return json({
    ok: true,
    activities: snapshot.docs.map((doc) => toActivityLog(doc.id, doc.data())),
  });
}
