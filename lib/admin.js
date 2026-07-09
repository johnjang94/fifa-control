import { getDb } from "./firestore";

const ADMIN_SESSION_COLLECTION = "admin_sessions";
const ADMIN_ALLOWLIST = new Set([
  "john jang|647-553-3499",
]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseAdminAuthPayload(body) {
  const firstName = normalizeString(body?.firstName);
  const phoneNumber = normalizeString(body?.phoneNumber);

  if (!firstName || !phoneNumber) {
    throw new Error("firstName and phoneNumber are required.");
  }

  return { firstName, phoneNumber };
}

export async function createAdminSession(db, payload) {
  const doc = await db.collection(ADMIN_SESSION_COLLECTION).add({
    ...payload,
    createdAt: new Date(),
  });

  return {
    id: doc.id,
    firstName: payload.firstName,
    phoneNumber: payload.phoneNumber,
    createdAt: new Date().toISOString(),
  };
}

export async function verifyAdminIdentity(db, payload) {
  const allowlistKey = `${payload.firstName.toLowerCase()}|${payload.phoneNumber}`;
  if (ADMIN_ALLOWLIST.has(allowlistKey)) {
    return true;
  }

  const snapshot = await db
    .collection("invite_requests")
    .where("firstName", "==", payload.firstName)
    .where("phoneNumber", "==", payload.phoneNumber)
    .limit(1)
    .get();

  return !snapshot.empty;
}
