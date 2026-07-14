import { Timestamp } from "firebase-admin/firestore";

function toISOString(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return new Date().toISOString();
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhoneNumber(value) {
  return normalizeString(value).replace(/\D/g, "");
}

function truncateText(value, maxLength = 140) {
  const text = normalizeString(value).replace(/\s+/g, " ");
  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, Math.max(0, maxLength - 1)).trimEnd();
}

function isHumanRequestMessage(message) {
  const normalized = normalizeString(message).toLowerCase();
  const directTalkPatterns = [
    /\b(human|person|agent|representative|operator|real person|live person|support staff)\b/i,
    /\b(talk|speak|chat|connect|reach out|contact|transfer|escalate)\b.*\b(to|with)?\b.*\b(someone|someone else|a person|a human|an agent|support|staff|the host|admin|manager|representative)\b/i,
    /\b(can i|could i|let me|i want to|i need to|please)\b.*\b(talk|speak|chat|connect|contact|reach out|get)\b.*\b(to|with)?\b.*\b(someone|someone else|a person|a human|an agent|support|staff|the host|admin|manager|representative)\b/i,
    /\b(put me through|pass me to|hand me off to|route me to)\b.*\b(someone|someone else|a person|a human|an agent|support|staff|the host|admin|manager|representative)\b/i,
  ];

  return directTalkPatterns.some((pattern) => pattern.test(normalized));
}

function summarizeThread(existingThread = []) {
  return existingThread
    .slice(-6)
    .map((entry) => {
      const role = entry.role === "assistant" ? "Support" : "Guest";
      const message = normalizeString(entry.message);
      return `${role}: ${message}`;
    })
    .filter(Boolean)
    .join("\n");
}

function buildReasonFallback({ message, existingThread = [] }) {
  const threadContext = summarizeThread(existingThread);
  const rawMessage = truncateText(message, 140);
  const candidate = threadContext ? `${rawMessage}` : rawMessage;
  return truncateText(candidate || "Guest wants help from the host.", 140);
}

function buildTitleFallback({ message, question, answer, existingThread = [] }) {
  const firstCustomerMessage = existingThread.find((entry) => entry.role === "customer")?.message;
  const candidate =
    normalizeString(firstCustomerMessage) ||
    normalizeString(question) ||
    normalizeString(message) ||
    normalizeString(answer) ||
    "Support chat";

  return truncateText(candidate, 56);
}

function normalizeTicketCode(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

function buildTicketCodeFallback(id) {
  const source = normalizeString(id).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (source.length >= 8) {
    return source.slice(0, 8);
  }

  return source.padEnd(8, "X").slice(0, 8);
}

export function createTicketCode() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let value = "";

  for (let index = 0; index < 8; index += 1) {
    const randomIndex = Math.floor(Math.random() * alphabet.length);
    value += alphabet.charAt(randomIndex);
  }

  return value;
}

export async function buildSupportReason(message, customerName, existingThread = []) {
  const apiFallback = buildReasonFallback({ message, existingThread });
  const reason = truncateText(normalizeString(message) || apiFallback, 140);
  return reason || apiFallback || normalizeString(customerName) || "Support request";
}

export async function buildSupportThreadTitle({
  message,
  question = "",
  answer = "",
  customerName = "",
  existingThread = [],
}) {
  const fallback = buildTitleFallback({ message, question, answer, existingThread });
  const title = truncateText(
    normalizeString(question) ||
      normalizeString(message) ||
      normalizeString(answer) ||
      normalizeString(customerName) ||
      fallback,
    56,
  );

  return title || fallback;
}

export function parseSupportPayload(body) {
  const message = normalizeString(body?.message);
  const inviteToken = normalizePhoneNumber(body?.inviteToken ?? body?.phoneNumber);
  const ticketId = normalizeString(body?.ticketId);
  const contactName = normalizeString(body?.contactName);
  const contactPhoneNumber = normalizePhoneNumber(body?.contactPhoneNumber ?? body?.phoneNumber);

  if (!message) {
    throw new Error("message is required.");
  }

  return {
    message,
    inviteToken,
    ticketId,
    contactName,
    contactPhoneNumber,
    wantsHumanSupport: isHumanRequestMessage(message),
  };
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
    inviteId: String(data.inviteId ?? data.inviteToken ?? id),
    customer: String(data.customer ?? data.questionerName ?? "Unknown guest"),
    assignedTo: String(data.assignedTo ?? data.ownerName ?? "Unassigned"),
    question: String(data.question ?? ""),
    answer: String(data.answer ?? thread.find((entry) => entry.role === "agent")?.message ?? ""),
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
    humanConnectionSmsSentAt: toISOString(data.humanConnectionSmsSentAt),
    humanTimeoutNoticeAt: toISOString(data.humanTimeoutNoticeAt),
    supportChatReadAt: toISOString(data.supportChatReadAt),
    supportChatActiveAt: toISOString(data.supportChatActiveAt),
    supportChatInactiveAt: toISOString(data.supportChatInactiveAt),
    supportChatState: String(data.supportChatState ?? ""),
    createdAt: toISOString(data.createdAt),
    updatedAt: toISOString(data.updatedAt),
    topic: String(data.topic ?? "support"),
    suggestedAction: String(data.suggestedAction ?? "none"),
    requestReason: String(data.requestReason ?? ""),
    ticketCode: normalizeTicketCode(data.ticketCode) || buildTicketCodeFallback(id),
    summaryTitle:
      String(data.summaryTitle ?? "").trim() ||
      buildTitleFallback({
        message: data.question,
        question: data.question,
        answer: data.answer,
        existingThread: thread,
      }),
    thread,
  };
}

export function isHumanRequest(message) {
  return isHumanRequestMessage(message);
}
