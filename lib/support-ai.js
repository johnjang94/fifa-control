const SUPPORT_BUSY_REPLY =
  "Sorry. All of our customer service representatives are currently helping other guests. Please wait a moment and we will reply as soon as someone is available.";
const SUPPORT_ASSISTANT_NAME = "Miranda";
const SUPPORT_OFF_TOPIC_LIMIT = 3;
const SUPPORT_EVENT_FACTS = [
  "Guests register through the watch party site, then they are placed on the waitlist first.",
  "After a guest completes the survey, they are sent back to login with a 'stay tuned for more updates!' message.",
  "Admins can move a guest from waitlist to confirmed when a spot opens up.",
  "The support flow should help with registration, waitlist, survey, login/OTP, profile photo, ticket details, the activity hub, the information section, privacy policy questions, and general event navigation.",
].join(" ");
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
    `Helpful event facts: ${SUPPORT_EVENT_FACTS}`,
    "Useful topics include invite registration, QR/check-in, RSVP, profile photo, support chat, survey, ticket details, login/OTP, waitlist status, activity hub, information section, privacy policy, and general event logistics.",
    `If the user asks for a human, a customer service representative, or if the unrelated-topic limit has already been reached, return the exact reply: ${SUPPORT_BUSY_REPLY}`,
    "Be warm, concise, and practical.",
    "Prefer broad, welcoming answers that keep the conversation moving forward.",
    "Avoid sounding restrictive or listing only the things you can handle unless the user has reached the unrelated-topic limit or asked for a human.",
    "If you are unsure, ask one short clarifying question about the app, but still include a useful next step.",
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

function buildHelpfulFallbackReply(message, customerName = "") {
  const normalized = normalizeString(message).toLowerCase();
  const safeFirstName = getFirstName(customerName);
  const greeting = safeFirstName ? `Hi ${safeFirstName}, ` : "";

  if (!normalized) {
    return `${greeting}I can help with most parts of the watch party experience, from registration and the waitlist to survey, login, profile updates, ticket details, and the information section. What are you trying to do?`;
  }

  if (/\b(what is this|what's this|about this party|about the party|party about|event about|what is the event)\b/i.test(normalized)) {
    return `${greeting}this is the FIFA X BTS Half-Time Show Watch Party, where guests register, join the waitlist, complete the survey, and get event updates. If you want, I can also point you to the right step in the flow.`;
  }

  if (/\b(how do i register|register|sign up|signup|join the party|join)\b/i.test(normalized)) {
    return `${greeting}to register, open the register flow and submit your details. If anything along the way feels unclear, tell me where you got stuck and I’ll help you get through it.`;
  }

  if (/\b(waitlist|wait list|capacity|spots left|full)\b/i.test(normalized)) {
    return `${greeting}the party has limited capacity, so guests may be kept on the waitlist until a spot opens up. If you’re checking your status or wondering what happens next, I can help with that too.`;
  }

  if (/\b(survey|take a quick survey|survey-done)\b/i.test(normalized)) {
    return `${greeting}after the survey, guests see a stay tuned message and are sent back to login. If you’re not seeing that flow, I can help figure out where it diverged.`;
  }

  if (/\b(login|otp|code|verification)\b/i.test(normalized)) {
    return `${greeting}login uses the verification code flow. If the code or screen is giving you trouble, I can help you narrow down the next step.`;
  }

  if (/\b(profile photo|photo|banner|profile image)\b/i.test(normalized)) {
    return `${greeting}you can update your profile photo and banner from your profile screen. If you want, I can help you find the upload controls or explain how that page works.`;
  }

  if (/\b(activity hub|information section|info section|privacy policy|policy|support chat|help|ticket|qr|check-in|check in|rsvp|venue|event)\b/i.test(normalized)) {
    return `${greeting}I can help you navigate the activity hub, information section, support chat, ticket details, and the rest of the event flow. If you tell me what page or step you’re looking at, I’ll take it from there.`;
  }

  if (/\b(register|signup|sign up|join|waitlist|survey|ticket|login|otp|photo|profile)\b/i.test(normalized)) {
    return `${greeting}I can help with registration, the waitlist, the survey, login, profile photo updates, ticket details, and nearby steps in the flow. Tell me what you’re trying to do, and I’ll help you move it forward.`;
  }

  if (/\b(how|where|when|can i|do i|does it|what happens)\b/i.test(normalized)) {
    return `${greeting}I can usually help with questions about the watch party flow, including registration, waitlist, survey, login, and profile or ticket updates. If you tell me what’s happening, I’ll help you sort it out.`;
  }

  return `${greeting}I can usually help with the watch party flow, account details, tickets, login, the waitlist, or where to find the right page. If you share a little more context, I’ll do my best to guide you from there.`;
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
  const reply = normalizeString(result.reply);
  const nextReply =
    reply && reply !== SUPPORT_BUSY_REPLY ? reply : buildHelpfulFallbackReply(message, customerName);

  if (!nextReply) {
    return {
      reply: related ? SUPPORT_BUSY_REPLY : SUPPORT_BUSY_REPLY,
      related,
      limitReached: false,
    };
  }

  return {
    reply: nextReply,
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
  return `Hi ${safeFirstName}, welcome to FIFA X BTS Half-Time Show Watch Party support. My name is ${SUPPORT_ASSISTANT_NAME}. How can I help you today?`;
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
    `${guestName} has requested to speak to you directly.`,
    `Summary: ${safeSummary}`,
    "Please intervene now and take over this conversation from the support channel. Thank you.",
    referenceParts.length ? `(${referenceParts.join(", ")})` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildNewSupportChatAdminSms({
  customerName,
  ticketId = "",
  ticketCode = "",
}) {
  const guestName = normalizeString(customerName) || "Guest";
  const safeTicketId = normalizeString(ticketId);
  const safeTicketCode = normalizeString(ticketCode);
  const referenceParts = [];

  if (safeTicketId) {
    referenceParts.push(`ticketId: ${safeTicketId}`);
  }

  if (safeTicketCode) {
    referenceParts.push(`ticketCode: ${safeTicketCode}`);
  }

  return `New FIFA X BTS support chat from ${guestName}${referenceParts.length ? ` (${referenceParts.join(", ")})` : ""}.`;
}
