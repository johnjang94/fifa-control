import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";

const ADMIN_SESSION_COLLECTION = "admin_sessions";
const ADMIN_USERS_COLLECTION = "admin_users";
const ADMIN_OTP_COLLECTION = "admin_otp_challenges";
const ADMIN_OTP_CODE_TTL_MS = 10 * 60 * 1000;
const ADMIN_OTP_MAX_ATTEMPTS = 5;
const ADMIN_ALLOWLIST = new Set([
  "john|jang|6475533499",
]);
const ADMIN_ROLES = new Set(["manager", "operator"]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhoneNumber(value) {
  return normalizeString(value).replace(/\D/g, "");
}

function normalizeOtpCode(value) {
  return normalizeString(value).replace(/\D/g, "").slice(0, 6);
}

function toMillis(value) {
  if (!value) {
    return 0;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }

  return 0;
}

function createAdminOtpSalt() {
  return randomBytes(16).toString("hex");
}

function hashAdminOtpCode(phoneNumber, code, salt) {
  return createHash("sha256")
    .update(`${normalizeString(salt)}:${normalizePhoneNumber(phoneNumber)}:${normalizeOtpCode(code)}`)
    .digest("hex");
}

function isTruthy(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeAdminRole(value) {
  const role = normalizeString(value).toLowerCase();
  if (role === "admin" || role === "manager") {
    return "manager";
  }

  if (role === "operator") {
    return "operator";
  }

  return "manager";
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
  const role = normalizeAdminRole(payload?.role);
  const doc = await db.collection(ADMIN_SESSION_COLLECTION).add({
    ...payload,
    role,
    createdAt: new Date(),
  });

  return {
    id: doc.id,
    firstName: payload.firstName,
    lastName: payload.lastName,
    phoneNumber: payload.phoneNumber,
    role,
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
      role: normalizeAdminRole(snapshot.data()?.role),
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
    const role = normalizeAdminRole(data.role);
    const active = isTruthy(data.active);
    const lastName = normalizeString(data.lastName);
    const phoneNumber = normalizePhoneNumber(data.phoneNumber);

    return (
      ADMIN_ROLES.has(role) &&
      active &&
      lastName === payload.lastName &&
      phoneNumber === normalizedInputPhone
    );
  });

  if (!matchedAdmin) {
    return {
      ok: false,
      error:
        "Admin account not found, inactive, or missing the manager/operator role.",
    };
  }

  return { ok: true, source: "admin_users" };
}

export async function findAdminByPhone(db, phoneNumber) {
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  if (!normalizedPhoneNumber) {
    return null;
  }

  const snapshot = await db.collection(ADMIN_USERS_COLLECTION).get();

  const matchedAdmin = snapshot.docs.find((doc) => {
    const data = doc.data() ?? {};
    const role = normalizeAdminRole(data.role);
    const active = isTruthy(data.active);
    const storedPhone = normalizePhoneNumber(data.phoneNumber);

    return ADMIN_ROLES.has(role) && active && storedPhone === normalizedPhoneNumber;
  });

  if (!matchedAdmin) {
    return null;
  }

  const data = matchedAdmin.data() ?? {};
  return {
    id: matchedAdmin.id,
    firstName: normalizeString(data.firstName),
    lastName: normalizeString(data.lastName),
    phoneNumber: normalizeString(data.phoneNumber),
    role: normalizeAdminRole(data.role),
  };
}

export async function listActiveAdminsByRole(db, roleName) {
  const role = normalizeAdminRole(roleName);
  const snapshot = await db.collection(ADMIN_USERS_COLLECTION).get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data() ?? {};
      return {
        id: doc.id,
        firstName: normalizeString(data.firstName),
        lastName: normalizeString(data.lastName),
        phoneNumber: normalizeString(data.phoneNumber),
        role: normalizeAdminRole(data.role),
        active: isTruthy(data.active),
      };
    })
    .filter((admin) => admin.active && admin.role === role && normalizePhoneNumber(admin.phoneNumber));
}

export function buildAdminOtpMessage(firstName, code) {
  const safeFirstName = normalizeString(firstName) || "there";
  return `Hi ${safeFirstName}, your FIFA admin verification code is ${code}.`;
}

export function buildOperatorLoginMessage(operatorName) {
  const safeName = normalizeString(operatorName) || "An operator";
  return `${safeName} just logged into the FIFA admin app.`;
}

export function generateAdminOtpCode() {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

export async function createAdminOtpChallenge(db, admin) {
  const phoneNumber = normalizePhoneNumber(admin?.phoneNumber);
  if (!phoneNumber) {
    throw new Error("phone number is required to create an OTP challenge.");
  }

  const code = generateAdminOtpCode();
  const salt = createAdminOtpSalt();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ADMIN_OTP_CODE_TTL_MS);

  await db.collection(ADMIN_OTP_COLLECTION).doc(phoneNumber).set({
    phoneNumber,
    adminId: normalizeString(admin?.id),
    firstName: normalizeString(admin?.firstName),
    lastName: normalizeString(admin?.lastName),
    codeSalt: salt,
    codeHash: hashAdminOtpCode(phoneNumber, code, salt),
    attempts: 0,
    createdAt: now,
    expiresAt,
    usedAt: null,
  });

  return {
    phoneNumber,
    code,
    expiresAt,
  };
}

export async function verifyAdminOtpChallenge(db, phoneNumber, code) {
  const safePhoneNumber = normalizePhoneNumber(phoneNumber);
  const safeCode = normalizeOtpCode(code);

  if (!safePhoneNumber || safeCode.length !== 6) {
    return { ok: false, error: "Invalid verification code." };
  }

  const docRef = db.collection(ADMIN_OTP_COLLECTION).doc(safePhoneNumber);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    return { ok: false, error: "Invalid or expired verification code." };
  }

  const data = snapshot.data() ?? {};
  if (data.usedAt) {
    return { ok: false, error: "This code has already been used." };
  }

  if (toMillis(data.expiresAt) && Date.now() > toMillis(data.expiresAt)) {
    return { ok: false, error: "Invalid or expired verification code." };
  }

  const attempts = Number(data.attempts ?? 0);
  if (attempts >= ADMIN_OTP_MAX_ATTEMPTS) {
    return { ok: false, error: "Too many invalid attempts. Please request a new code." };
  }

  const expectedHash = normalizeString(data.codeHash);
  const salt = normalizeString(data.codeSalt);
  const actualHash = hashAdminOtpCode(safePhoneNumber, safeCode, salt);
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  const actualBuffer = Buffer.from(actualHash, "hex");
  const matches =
    expectedBuffer.length === actualBuffer.length &&
    expectedBuffer.length > 0 &&
    timingSafeEqual(expectedBuffer, actualBuffer);

  if (!matches) {
    await docRef.set({ attempts: attempts + 1 }, { merge: true });
    return { ok: false, error: "Invalid verification code." };
  }

  await docRef.set(
    {
      attempts: attempts + 1,
      usedAt: new Date(),
    },
    { merge: true },
  );

  const admin = await findAdminByPhone(db, safePhoneNumber);
  if (!admin) {
    return { ok: false, error: "Admin account not found, inactive, or missing the manager/operator role." };
  }

  return { ok: true, admin };
}
