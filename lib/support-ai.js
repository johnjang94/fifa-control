const SUPPORT_BUSY_REPLY =
  "Sorry. All of our customer service representatives are currently helping other guests. Please wait a moment and we will reply as soon as someone is available.";
const SUPPORT_ASSISTANT_NAME = "Miranda";
const SUPPORT_OFF_TOPIC_LIMIT = 3;
const OPENAI_MODEL = process.env.OPENAI_SUPPORT_MODEL ?? "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 20_000;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getFirstName(value) {
  const normalized = normalizeString(value);
  if (!normalized || normalized.toLowerCase() === "unknown guest" || normalized.toLowerCase() === "you") {
    return "";
  }

  return normalized.split(/\s+/).filter(Boolean)[0] ?? "";
}

function formatThreadContext(existingThread = []) {
  return existingThread
    .slice(-8)
    .map((entry) => {
      const role = normalizeString(entry?.role) || "unknown";
      const name = normalizeString(entry?.senderName);
      const message = normalizeString(entry?.message);

      if (!message) {
        return "";
      }

      const label = name ? `${role}:${name}` : role;
      return `${label}: ${message}`;
    })
    .filter(Boolean)
    .join("\n");
}

function formatThreadSummaryFallback(existingThread = [], message = "", customerName = "") {
  const parts = [];
  const customerLabel = normalizeString(customerName) || "Guest";
  const latest = normalizeString(message);

  if (customerLabel) {
    parts.push(`Guest: ${customerLabel}`);
  }

  const customerMessages = existingThread
    .filter((entry) => normalizeString(entry?.role).toLowerCase() === "customer")
    .map((entry) => normalizeString(entry?.message))
    .filter(Boolean)
    .slice(-3);

  if (customerMessages.length) {
    parts.push(`Recent guest messages: ${customerMessages.join(" | ")}`);
  }

  if (latest) {
    parts.push(`Latest message: ${latest}`);
  }

  return parts.join(". ");
}

function buildSystemPrompt() {
  return [
    `You are ${SUPPORT_ASSISTANT_NAME}, the AI customer service assistant for FIFA X BTS Watch Party.`,
    `Help guests with questions related to the app or event. When the question is unrelated, still try to be helpful and answer briefly if possible, but remind the guest that you can only stay on unrelated topics for up to ${SUPPORT_OFF_TOPIC_LIMIT} questions total.`,
    "Useful topics include invite registration, QR/check-in, RSVP, profile photo, support chat, survey, ticket details, login/OTP, and general event logistics.",
    `If the user asks for a human, a customer service representative, or if the unrelated-topic limit has already been reached, return the exact reply: ${SUPPORT_BUSY_REPLY}`,
    "Be warm, concise, and practical.",
    "If you are unsure, ask one short clarifying question about the app.",
    "Return JSON only in the form {\"reply\":\"...\",\"related\":true|false}.",
  ].join(" ");
}

function parseAssistantReply(content) {
  const raw = normalizeString(content);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      reply: normalizeString(parsed?.reply),
      related: Boolean(parsed?.related),
    };
  } catch {
    return null;
  }
}

function looksLikeAppRelatedMessage(message) {
  const normalized = normalizeString(message).toLowerCase();
  if (!normalized) {
    return false;
  }

  const relatedPatterns = [
    /\b(fifa|bts|watch party|half-time|halftime|support chat|chat|invite|ticket|qr|check-in|check in|rsvp|survey|profile photo|photo|login|otp|password|account|venue|event)\b/i,
    /\b(when|where|how|why|what|can i|do i|does|is my|my ticket|my invite|my qr|my account)\b/i,
  ];

  return relatedPatterns.some((pattern) => pattern.test(normalized));
}

async function callOpenAiSupportAssistant({ customerName, message, existingThread = [], offTopicStreak = 0 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(),
          },
          {
            role: "user",
            content: [
              `Customer name: ${normalizeString(customerName) || "Unknown guest"}`,
              `Current unrelated-topic streak: ${offTopicStreak}`,
              `Latest message: ${normalizeString(message)}`,
              "Conversation context:",
              formatThreadContext(existingThread) || "No prior context.",
            ].join("\n"),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json().catch(() => null);
    return parseAssistantReply(data?.choices?.[0]?.message?.content);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOpenAiEscalationSummary({ customerName, message, existingThread = [] }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return "";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are a support handoff assistant for a live event app.",
              "Summarize the conversation for a human customer service agent in one or two short sentences.",
              "Focus on the guest's issue, any relevant app or event context, and whether the guest asked for a human.",
              "Return JSON only in the form {\"summary\":\"...\"}.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Customer name: ${normalizeString(customerName) || "Unknown guest"}`,
              `Latest message: ${normalizeString(message)}`,
              "Conversation context:",
              formatThreadContext(existingThread) || "No prior context.",
            ].join("\n"),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return "";
    }

    const data = await response.json().catch(() => null);
    const raw = normalizeString(data?.choices?.[0]?.message?.content);
    if (!raw) {
      return "";
    }

    try {
      const parsed = JSON.parse(raw);
      return normalizeString(parsed?.summary);
    } catch {
      return "";
    }
  } catch {
    return "";
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateSupportAssistantReply({
  customerName,
  message,
  existingThread = [],
  wantsHumanSupport = false,
  offTopicStreak = 0,
}) {
  if (wantsHumanSupport) {
    return {
      reply: SUPPORT_BUSY_REPLY,
      related: false,
      limitReached: true,
    };
  }

  if (offTopicStreak >= SUPPORT_OFF_TOPIC_LIMIT) {
    return {
      reply: SUPPORT_BUSY_REPLY,
      related: false,
      limitReached: true,
    };
  }

  const result = (await callOpenAiSupportAssistant({
    customerName,
    message,
    existingThread,
    offTopicStreak,
  })) ?? {};

  const related = typeof result.related === "boolean" ? result.related : looksLikeAppRelatedMessage(message);
  const reply = normalizeString(result.reply) || (related ? "" : "");

  if (!reply) {
    return {
      reply: related ? SUPPORT_BUSY_REPLY : SUPPORT_BUSY_REPLY,
      related,
      limitReached: false,
    };
  }

  return {
    reply,
    related,
    limitReached: false,
  };
}

export async function generateSupportEscalationSummary({
  customerName,
  message,
  existingThread = [],
}) {
  const summary = await callOpenAiEscalationSummary({
    customerName,
    message,
    existingThread,
  });

  return summary || formatThreadSummaryFallback(existingThread, message, customerName);
}

export function buildSupportWelcomeMessage(firstName) {
  const safeFirstName = getFirstName(firstName) || "there";
  return `Hi ${safeFirstName}, welcome to FIFA X BTS support. My name is ${SUPPORT_ASSISTANT_NAME}. How can I help you today?`;
}

export function getSupportAssistantName() {
  return SUPPORT_ASSISTANT_NAME;
}

export function getSupportBusyReply() {
  return SUPPORT_BUSY_REPLY;
}

export function buildHumanEscalationAdminSms({
  customerName,
  summary,
  ticketId = "",
  ticketCode = "",
}) {
  const guestName = normalizeString(customerName) || "Guest";
  const safeSummary = normalizeString(summary) || "The guest requested help from a human agent.";
  const safeTicketId = normalizeString(ticketId);
  const safeTicketCode = normalizeString(ticketCode);
  const referenceParts = [];

  if (safeTicketId) {
    referenceParts.push(`ticketId: ${safeTicketId}`);
  }

  if (safeTicketCode) {
    referenceParts.push(`ticketCode: ${safeTicketCode}`);
  }

  return [
    `Human escalation requested for ${guestName}${referenceParts.length ? ` (${referenceParts.join(", ")})` : ""}.`,
    `Summary: ${safeSummary}`,
    "Please intervene now and take over this conversation in the admin dashboard.",
  ].join(" ");
}

export function buildNewSupportChatAdminSms({
  customerName,
  requestReason,
  ticketId = "",
  ticketCode = "",
}) {
  const guestName = normalizeString(customerName) || "Guest";
  const reason = normalizeString(requestReason);
  const reasonSuffix = reason ? ` Initial issue: ${reason.slice(0, 140)}` : "";
  const safeTicketId = normalizeString(ticketId);
  const safeTicketCode = normalizeString(ticketCode);
  const referenceParts = [];

  if (safeTicketId) {
    referenceParts.push(`ticketId: ${safeTicketId}`);
  }

  if (safeTicketCode) {
    referenceParts.push(`ticketCode: ${safeTicketCode}`);
  }

  return `New FIFA X BTS support chat from ${guestName}${referenceParts.length ? ` (${referenceParts.join(", ")})` : ""}. Miranda greeted the guest in-app.${reasonSuffix}`;
}
