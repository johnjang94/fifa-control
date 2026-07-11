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
  const token = (request.nextUrl.searchParams.get("token") ?? "").trim();
  const barcode = (request.nextUrl.searchParams.get("barcode") ?? "").trim();
  if (token || barcode) {
    if (token) {
      const snapshot = await getDb().collection("invite_requests").doc(token).get();
      if (snapshot.exists) {
        return json({
          ok: true,
          user: toInviteRequest(snapshot.id, snapshot.data() ?? {}),
        });
      }
    }

    const queryValue = barcode || token;
    const barcodeSnapshot = await getDb()
      .collection("invite_requests")
      .where("barcode", "==", queryValue)
      .limit(1)
      .get();

    if (barcodeSnapshot.empty) {
      return json({ ok: false, error: "User not found." }, { status: 404 });
    }

    const doc = barcodeSnapshot.docs[0];
    return json({
      ok: true,
      user: toInviteRequest(doc.id, doc.data() ?? {}),
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

export async function PATCH(request) {
  if (!adminKeyMatches(request)) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const inviteToken = String(payload?.inviteToken ?? "").trim();
    const barcode = String(payload?.barcode ?? "").trim();

    if (!inviteToken && !barcode) {
      return json({ ok: false, error: "inviteToken or barcode is required." }, { status: 400 });
    }

    const db = getDb();
    let docRef = null;

    if (inviteToken) {
      const directSnapshot = await db.collection("invite_requests").doc(inviteToken).get();
      if (directSnapshot.exists) {
        docRef = directSnapshot.ref;
      }
    }

    if (!docRef && barcode) {
      const barcodeSnapshot = await db
        .collection("invite_requests")
        .where("barcode", "==", barcode)
        .limit(1)
        .get();

      if (!barcodeSnapshot.empty) {
        docRef = barcodeSnapshot.docs[0].ref;
      }
    }

    if (!docRef) {
      return json({ ok: false, error: "User not found." }, { status: 404 });
    }

    await docRef.set(
      {
        checkedInAt: new Date(),
        checkedInSource: "watch-party-admin",
      },
      { merge: true },
    );

    const snapshot = await docRef.get();
    return json({
      ok: true,
      user: toInviteRequest(snapshot.id, snapshot.data() ?? {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to check in user.";
    return json({ ok: false, error: message }, { status: 400 });
  }
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
