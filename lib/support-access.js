import { createHmac, timingSafeEqual } from "crypto";

const SUPPORT_ACCESS_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhoneNumber(value) {
  return normalizeString(value).replace(/\D/g, "");
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getSupportAccessSecret() {
  const secret =
    normalizeString(process.env.SUPPORT_ACCESS_SECRET) ||
    normalizeString(process.env.ADMIN_ACCESS_KEY);

  if (!secret) {
    throw new Error("Support access secret is not configured.");
  }

  return secret;
}

export function createSupportAccessToken(invite) {
  const inviteId = normalizeString(invite?.id);
  const phoneNumber = normalizePhoneNumber(invite?.phoneNumber);

  if (!inviteId || !phoneNumber) {
    throw new Error("invite id and phone number are required to create a support token.");
  }

  const now = Date.now();
  const payload = {
    v: 1,
    inviteId,
    phoneNumber,
    iat: now,
    exp: now + SUPPORT_ACCESS_TTL_MS,
  };
  const serializedPayload = JSON.stringify(payload);
  const signature = createHmac("sha256", getSupportAccessSecret())
    .update(serializedPayload)
    .digest("base64url");

  return `${base64UrlEncode(serializedPayload)}.${signature}`;
}

export function verifySupportAccessToken(token) {
  const safeToken = normalizeString(token);
  if (!safeToken) {
    return null;
  }

  const [payloadPart, signaturePart] = safeToken.split(".");
  if (!payloadPart || !signaturePart) {
    return null;
  }

  try {
    const serializedPayload = base64UrlDecode(payloadPart);
    const expectedSignature = createHmac("sha256", getSupportAccessSecret())
      .update(serializedPayload)
      .digest();
    const providedSignature = Buffer.from(signaturePart, "base64url");

    if (providedSignature.length !== expectedSignature.length) {
      return null;
    }

    if (!timingSafeEqual(providedSignature, expectedSignature)) {
      return null;
    }

    const payload = JSON.parse(serializedPayload);
    if (!payload || payload.v !== 1) {
      return null;
    }

    if (
      !normalizeString(payload.inviteId) ||
      !normalizePhoneNumber(payload.phoneNumber) ||
      !Number.isFinite(payload.exp) ||
      Date.now() > Number(payload.exp)
    ) {
      return null;
    }

    return {
      inviteId: normalizeString(payload.inviteId),
      phoneNumber: normalizePhoneNumber(payload.phoneNumber),
      issuedAt: Number(payload.iat) || 0,
      expiresAt: Number(payload.exp),
    };
  } catch {
    return null;
  }
}

export function extractSupportAccessToken(request) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);

  if (bearerMatch?.[1]) {
    return normalizeString(bearerMatch[1]);
  }

  const headerToken = request.headers.get("x-support-access-token") ?? "";
  return normalizeString(headerToken);
}

export async function getAuthorizedInvite(db, request) {
  const token = extractSupportAccessToken(request);
  const tokenData = verifySupportAccessToken(token);

  if (!tokenData) {
    return null;
  }

  const snapshot = await db.collection("invite_requests").doc(tokenData.inviteId).get();
  if (!snapshot.exists) {
    return null;
  }

  const data = snapshot.data() ?? {};
  const phoneNumber = normalizePhoneNumber(data.phoneNumber);
  if (!phoneNumber || phoneNumber !== tokenData.phoneNumber) {
    return null;
  }

  return {
    id: snapshot.id,
    phoneNumber,
    invite: data,
  };
}
