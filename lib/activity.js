function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseActivityPayload(body) {
  const eventType = normalizeString(body?.eventType);
  const phoneNumber = normalizeString(body?.phoneNumber);
  const inviteToken = normalizeString(body?.inviteToken);
  const sessionId = normalizeString(body?.sessionId);
  const userAgent = normalizeString(body?.userAgent);
  const pathname = normalizeString(body?.pathname);
  const method = normalizeString(body?.method);
  const reason = normalizeString(body?.reason);

  if (!eventType) {
    throw new Error("eventType is required.");
  }

  return {
    eventType,
    phoneNumber: phoneNumber || null,
    inviteToken: inviteToken || null,
    sessionId: sessionId || null,
    userAgent: userAgent || null,
    pathname: pathname || null,
    method: method || null,
    reason: reason || null,
  };
}

export function toActivityLog(id, data) {
  const createdAt = data.createdAt;
  const timestamp =
    createdAt?.toDate?.()?.toISOString?.() ??
    (typeof createdAt === "string" ? createdAt : new Date().toISOString());

  return {
    id,
    eventType: String(data.eventType ?? ""),
    phoneNumber: data.phoneNumber ?? null,
    inviteToken: data.inviteToken ?? null,
    sessionId: data.sessionId ?? null,
    userAgent: data.userAgent ?? null,
    pathname: data.pathname ?? null,
    method: data.method ?? null,
    reason: data.reason ?? null,
    createdAt: timestamp,
  };
}
