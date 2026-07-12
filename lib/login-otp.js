import { createHmac, randomInt, timingSafeEqual } from "crypto";

export const OTP_COLLECTION = "login_otp_challenges";
export const OTP_CODE_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

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

function getOtpSecret() {
  const secret =
    normalizeString(process.env.OTP_SECRET) ||
    normalizeString(process.env.SUPPORT_ACCESS_SECRET) ||
    normalizeString(process.env.ADMIN_ACCESS_KEY);

  if (!secret) {
    throw new Error("OTP secret is not configured.");
  }

  return secret;
}

function hashOtpCode(phoneNumber, code) {
  return createHmac("sha256", getOtpSecret())
    .update(`${normalizePhoneNumber(phoneNumber)}:${normalizeOtpCode(code)}`)
    .digest("hex");
}

export function generateOtpCode() {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

export function buildOtpMessage(firstName, code) {
  const safeFirstName = normalizeString(firstName) || "there";
  return `Hi ${safeFirstName}, this is FIFA FINAL X BTS Half-Time Show Watch Party. We are sending you 2-Step Verification code for privacy and security purpose. Please do not show this code to anyone else. Your code is: ${code}`;
}

export async function createOtpChallenge(db, invite) {
  const phoneNumber = normalizePhoneNumber(invite?.phoneNumber);
  const inviteId = normalizeString(invite?.id);

  if (!phoneNumber || !inviteId) {
    throw new Error("invite id and phone number are required to create an OTP challenge.");
  }

  const code = generateOtpCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_CODE_TTL_MS);

  await db.collection(OTP_COLLECTION).doc(phoneNumber).set({
    phoneNumber,
    inviteId,
    codeHash: hashOtpCode(phoneNumber, code),
    attempts: 0,
    createdAt: now,
    expiresAt,
    usedAt: null,
  });

  return {
    phoneNumber,
    inviteId,
    code,
    expiresAt,
  };
}

export async function verifyOtpChallenge(db, phoneNumber, code) {
  const safePhoneNumber = normalizePhoneNumber(phoneNumber);
  const safeCode = normalizeOtpCode(code);

  if (!safePhoneNumber || safeCode.length !== 6) {
    return { ok: false, error: "Invalid verification code." };
  }

  const docRef = db.collection(OTP_COLLECTION).doc(safePhoneNumber);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    return { ok: false, error: "Invalid or expired verification code." };
  }

  const data = snapshot.data() ?? {};
  if (data.usedAt) {
    return { ok: false, error: "This code has already been used." };
  }

  const expiresAtMs = toMillis(data.expiresAt);
  if (!expiresAtMs || Date.now() > expiresAtMs) {
    await docRef.delete().catch(() => {});
    return { ok: false, error: "This code has expired. Please request a new one." };
  }

  const attempts = Number(data.attempts ?? 0);
  if (attempts >= OTP_MAX_ATTEMPTS) {
    await docRef.delete().catch(() => {});
    return { ok: false, error: "Too many invalid attempts. Please request a new code." };
  }

  const providedHash = Buffer.from(hashOtpCode(safePhoneNumber, safeCode), "hex");
  const storedHashRaw = normalizeString(data.codeHash);
  const storedHash = storedHashRaw ? Buffer.from(storedHashRaw, "hex") : null;

  if (!storedHash || storedHash.length !== providedHash.length || !timingSafeEqual(storedHash, providedHash)) {
    await docRef.set(
      {
        attempts: attempts + 1,
        lastAttemptAt: new Date(),
      },
      { merge: true },
    );

    return { ok: false, error: "Invalid verification code." };
  }

  await docRef.delete().catch(() => {});

  return {
    ok: true,
    inviteId: normalizeString(data.inviteId),
    phoneNumber: safePhoneNumber,
  };
}
