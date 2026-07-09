import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/firestore";
import { toInquiryItem } from "../../../../lib/inquiry";

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

export async function GET() {
  const snapshot = await getDb().collection("guest_faq_inquiries").orderBy("createdAt", "desc").limit(100).get();
  return json({
    ok: true,
    inquiries: snapshot.docs.map((doc) => toInquiryItem(doc.id, doc.data())),
  });
}

