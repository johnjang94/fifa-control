const ADMIN_SESSION_COLLECTION = "admin_sessions";
const ADMIN_USERS_COLLECTION = "admin_users";
const ADMIN_ALLOWLIST = new Set([
  "john|jang|6475533499",
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
  const lastName = normalizeString(body?.lastName);
  const phoneNumber = normalizeString(body?.phoneNumber);

  if (!firstName || !lastName || !phoneNumber) {
    throw new Error("firstName, lastName, and phoneNumber are required.");
  }

  return { firstName, lastName, phoneNumber };
}

export async function createAdminSession(db, payload) {
  const doc = await db.collection(ADMIN_SESSION_COLLECTION).add({
    ...payload,
    createdAt: new Date(),
  });

  return {
    id: doc.id,
    firstName: payload.firstName,
    lastName: payload.lastName,
    phoneNumber: payload.phoneNumber,
    createdAt: new Date().toISOString(),
  };
}

export async function verifyAdminSession(db, sessionId) {
  const safeSessionId = normalizeString(sessionId);
  if (!safeSessionId) {
    return { ok: false, error: "Admin session is required." };
  }

  const snapshot = await db.collection(ADMIN_SESSION_COLLECTION).doc(safeSessionId).get();
  if (!snapshot.exists) {
    return { ok: false, error: "Admin session not found." };
  }

  return {
    ok: true,
    session: {
      id: snapshot.id,
      ...(snapshot.data() ?? {}),
    },
  };
}

export async function verifyAdminIdentity(db, payload) {
  const allowlistKey = `${payload.firstName.toLowerCase()}|${payload.lastName.toLowerCase()}|${normalizePhoneNumber(payload.phoneNumber)}`;
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
    const lastName = normalizeString(data.lastName);
    const phoneNumber = normalizePhoneNumber(data.phoneNumber);

    return (
      role === "admin" &&
      active &&
      lastName === payload.lastName &&
      phoneNumber === normalizedInputPhone
    );
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
