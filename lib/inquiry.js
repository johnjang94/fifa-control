import { Timestamp } from "firebase-admin/firestore";

function toISOString(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhoneNumber(value) {
  return normalizeString(value).replace(/\D/g, "");
}

function isHumanRequestMessage(message) {
  const normalized = normalizeString(message).toLowerCase();

  return (
    /\b(human|person|agent|representative|operator|real person|live person|support staff)\b/i.test(
      normalized,
    ) ||
    /상담원|사람|실제\s*사람|직원|담당자|인간/.test(normalized)
  );
}

function buildAutoReply(message, customerName) {
  const normalized = normalizeString(message).toLowerCase();
  const nameFragment = customerName ? `, ${customerName}` : "";

  if (normalized.includes("check")) {
    return `Thanks${nameFragment}. We are checking that now.`;
  }

  if (normalized.includes("time") || normalized.includes("when")) {
    return `Thanks${nameFragment}. We will confirm the timing and reply shortly.`;
  }

  if (normalized.includes("ticket") || normalized.includes("qr")) {
    return `Thanks${nameFragment}. We are looking into your ticket and QR details.`;
  }

  return `Thanks${nameFragment}. A support agent will review this shortly.`;
}

function findLatestAgentMessage(thread) {
  const lastAgentEntry = [...thread].reverse().find((entry) => entry.role === "agent");
  return lastAgentEntry?.message ?? "";
}

export function parseSupportPayload(body) {
  const message = normalizeString(body?.message);
  const inviteToken = normalizePhoneNumber(body?.inviteToken ?? body?.phoneNumber);
  const ticketId = normalizeString(body?.ticketId);
  const wantsHumanSupport = isHumanRequestMessage(message);

  if (!message) {
    throw new Error("message is required.");
  }

  return { message, inviteToken, ticketId, wantsHumanSupport };
}

export function buildSupportThread({ existingThread = [], message, customerName }) {
  const now = new Date().toISOString();
  const assistantMessage = buildAutoReply(message, customerName);

  return [
    ...existingThread,
    {
      role: "customer",
      message,
      createdAt: now,
    },
    {
      role: "assistant",
      message: assistantMessage,
      createdAt: now,
    },
  ];
}

export function toInquiryItem(id, data) {
  const thread = Array.isArray(data.thread)
    ? data.thread.map((item) => ({
        role: String(item.role ?? "system"),
        message: String(item.message ?? ""),
        createdAt: toISOString(item.createdAt),
      }))
    : [];

  return {
    id,
    customer: String(data.customer ?? data.questionerName ?? "Guest"),
    assignedTo: String(data.assignedTo ?? data.ownerName ?? "Unassigned"),
    question: String(data.question ?? ""),
    answer: String(data.answer ?? findLatestAgentMessage(thread)),
    customerPhotoUrl:
      typeof data.customerPhotoUrl === "string"
        ? data.customerPhotoUrl
        : typeof data.profilePhotoUrl === "string"
          ? data.profilePhotoUrl
          : null,
    phoneNumber: String(data.phoneNumber ?? ""),
    inviteToken: String(data.inviteToken ?? ""),
    currentAgent: String(data.currentAgent ?? data.assignedTo ?? "Unassigned"),
    status: String(data.status ?? "open"),
    humanRequestedAt: toISOString(data.humanRequestedAt),
    humanAcknowledgedAt: toISOString(data.humanAcknowledgedAt),
    createdAt: toISOString(data.createdAt),
    updatedAt: toISOString(data.updatedAt),
    thread,
  };
}

export function isHumanRequest(message) {
  return isHumanRequestMessage(message);
}
