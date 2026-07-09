const ADMIN_SESSION_COLLECTION = "admin_sessions";
const ADMIN_USERS_COLLECTION = "admin_users";
const ADMIN_ALLOWLIST = new Set([
  "john jang|6475533499",
]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhoneNumber(value) {
  return normalizeString(value).replace(/\D/g, "");
}

function isTruthy(value) {
  return value === true || value === "true" || value === 1 || value === "1";
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
  const allowlistKey = `${payload.firstName.toLowerCase()}|${normalizePhoneNumber(payload.phoneNumber)}`;
  if (ADMIN_ALLOWLIST.has(allowlistKey)) {
    return { ok: true, source: "allowlist" };
  }

  const snapshot = await db
    .collection(ADMIN_USERS_COLLECTION)
    .where("firstName", "==", payload.firstName)
    .get();

  const normalizedInputPhone = normalizePhoneNumber(payload.phoneNumber);
  const matchedAdmin = snapshot.docs.find((doc) => {
    const data = doc.data() ?? {};
    const role = normalizeString(data.role).toLowerCase();
    const active = isTruthy(data.active);
    const phoneNumber = normalizePhoneNumber(data.phoneNumber);

    return role === "admin" && active && phoneNumber === normalizedInputPhone;
  });

  if (!matchedAdmin) {
    return {
      ok: false,
      error:
        "Admin account not found, inactive, or missing the admin role.",
    };
  }

  return { ok: true, source: "admin_users" };
}
