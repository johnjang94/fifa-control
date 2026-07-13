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

function truncateText(value, maxLength = 140) {
  const text = normalizeString(value).replace(/\s+/g, " ");
  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, Math.max(0, maxLength - 1)).trimEnd();
}

function isYesLikeMessage(message) {
  const normalized = normalizeString(message).toLowerCase();
  return /^(yes|yeah|yep|sure|ok|okay|please do|of course|absolutely|go ahead|sounds good)\b/.test(normalized);
}

function isEnglishOnlyMessage(message) {
  return !/[\u00C0-\u024F\u0400-\u04FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/.test(
    normalizeString(message),
  );
}

function isBringFoodIntent(message) {
  const normalized = normalizeString(message).toLowerCase();
  return (
    /bring.*(food|snack|snacks|bbq|dish|item|drink|drinks|beverage|beverages|soda|juice|water|refreshment|refreshments)/i.test(
      normalized,
    ) ||
    /(food|snack|snacks|bbq|dish|item|drink|drinks|beverage|beverages|soda|juice|water|refreshment|refreshments).*(bring|bring along|take)/i.test(
      normalized,
    ) ||
    /i can bring/i.test(normalized) ||
    /want to bring/i.test(normalized) ||
    /would like to bring/i.test(normalized) ||
    /food.*bring/i.test(normalized) ||
    /snack.*bring/i.test(normalized) ||
    /bbq.*bring/i.test(normalized) ||
    /drink.*bring/i.test(normalized) ||
    /beverage.*bring/i.test(normalized)
  );
}

function detectSupportTopic(message) {
  const normalized = normalizeString(message).toLowerCase();

  if (/weather|rain|raining|storm|snow|snowing|wind|forecast|temperature|hot|cold|humid|sunny|cloudy|bad weather/i.test(normalized)) {
    return "weather";
  }

  if (/parking|park/i.test(normalized)) {
    return "parking";
  }

  if (/venue|address|location|where|place/i.test(normalized)) {
    return "venue";
  }

  if (/time|when|schedule|timing|open|close|closing|start|end/i.test(normalized)) {
    return "timing";
  }

  if (/party|food|drink|drinks|beverage|bbq|snack|menu|potluck/i.test(normalized)) {
    return isBringFoodIntent(normalized) ? "bring_food" : "party";
  }

  return "general";
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

function buildLegacyAutoReply(message, customerName) {
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

function buildParkingReply() {
  return "We have a few easy options nearby: 15 Lower Jarvis has a Loblaw where you can park, Green P Parking is close to St. Lawrence Market, and there is guest parking in the building too.";
}

function buildVenueReply() {
  return "We are at 138 Downes Street, Toronto, ON M5E 0E4.";
}

function buildTimingReply() {
  return "We are on Sunday, July 19, 2026 from 12:00 pm to 5:00 pm.";
}

function buildWeatherReply() {
  return "We do not have live weather updates here, but if the weather turns rough we will let everyone know right away.";
}

function buildPartyReply() {
  return "We already have the basics covered, so if you want to bring something extra, that is totally fine.";
}

function buildBringFoodReply() {
  return "We would love that. I’ll open a quick form so you can send the details over.";
}

function buildBringFoodConfirmationReply() {
  return "We just need the form below filled out and sent over. We’ll pass the details to the host.";
}

function buildGeneralReply() {
  return "We can help with the party, venue, timing, parking, or food. If you had something else in mind, just send it over and we’ll help you out.";
}

function buildEnglishOnlyReply() {
  return "We need that in English so we can jump in right away.";
}

function buildAdminRequestReply() {
  return "We got it and sent that to the host.";
}

function ensureWeLead(text) {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return "We can help with that.";
  }

  const normalized = raw.replace(/^["'`]+|["'`]+$/g, "");
  const lower = normalized.toLowerCase();

  if (lower.startsWith("we ")) {
    return normalized;
  }

  if (lower.startsWith("we're")) {
    return normalized;
  }

  if (lower.startsWith("we are")) {
    return normalized;
  }

  if (lower.startsWith("i'm")) {
    return `We are${normalized.slice(3)}`;
  }

  if (lower.startsWith("i've")) {
    return `We have${normalized.slice(4)}`;
  }

  if (lower.startsWith("i'll")) {
    return `We will${normalized.slice(4)}`;
  }

  if (lower.startsWith("i ")) {
    return `We${normalized.slice(1)}`;
  }

  if (lower.startsWith("my ")) {
    return `Our${normalized.slice(2)}`;
  }

  return `We ${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}`;
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
  const firstCustomerMessage = existingThread
    .find((entry) => entry.role === "customer")
    ?.message;
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

async function generateThreadTitle({ message, question, answer, customerName, existingThread = [] }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const fallback = buildTitleFallback({ message, question, answer, existingThread });
  if (!apiKey) {
    return fallback;
  }

  const model = process.env.OPENAI_SUPPORT_MODEL || "gpt-4o-mini";
  const threadContext = summarizeThread(existingThread);
  const systemPrompt = [
    "You write a short title for a support thread.",
    "Summarize the guest's issue or request in 3 to 6 words.",
    "Return one line only.",
    "Do not use quotes, bullets, labels, emojis, or mention AI.",
    "Do not include the customer name unless it is essential to the meaning.",
  ].join(" ");

  const userPrompt = [
    `Customer name: ${customerName || "Unknown guest"}`,
    `Latest guest message: ${message}`,
    question ? `Existing question: ${question}` : "",
    answer ? `Current answer: ${answer}` : "",
    threadContext ? `Recent thread:\n${threadContext}` : "",
    "Return only the title text.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return fallback;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const title = Array.isArray(content) ? content.join(" ") : String(content ?? "").trim();
    const cleanedTitle = truncateText(
      normalizeString(title).replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ").replace(/[.?!]+$/, ""),
      56,
    );

    return cleanedTitle || fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateSupportReply({
  mode,
  message,
  customerName,
  existingThread = [],
  extraInstructions = [],
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENAI_SUPPORT_MODEL || "gpt-4o-mini";
  if (!isEnglishOnlyMessage(message)) {
    return buildEnglishOnlyReply();
  }
  const threadContext = summarizeThread(existingThread);
  const isGreeting = normalizeString(message).length <= 12;
  const systemPrompt = [
    "You are a warm, casual support helper for a FIFA half-time watch party.",
    "Sound like a real person texting back, not a support bot.",
    "Use everyday words, natural contractions, and a light friendly tone.",
    "Acknowledge the guest briefly when it feels natural, then answer directly.",
    "Do not mention policies, rules, or internal tooling unless the user asks directly.",
    "Never say you are an AI.",
    "Avoid phrases like 'I can assist', 'please note', 'for your convenience', or 'happy to help'.",
    "Every reply must begin with 'We'.",
    "Keep replies short, human, and easy to read.",
    "Treat the facts below as guidance, then rewrite them in a natural conversational way.",
  ].join(" ");

  const modePrompt =
    mode === "parking"
      ? [
          "The venue address is 138 Downes Street, Toronto, ON.",
          "Helpful parking guidance: 15 Lower Jarvis has a Loblaw where guests can park, Green P Parking is near St. Lawrence Market, and guest parking is available in the building.",
          "Answer like a helpful person, not a policy sheet.",
        ].join(" ")
      : mode === "venue"
        ? [
            "The venue address is 138 Downes Street, Toronto, ON M5E 0E4.",
            "Answer naturally, like you are texting a friend the address.",
          ].join(" ")
        : mode === "timing"
          ? [
              "The party is on Sunday, July 19, 2026 from 12:00 pm till 5:00 pm.",
              "Answer naturally, like you are confirming the time in a quick text.",
          ].join(" ")
        : mode === "weather"
          ? [
              "We do not have live weather data in this chat.",
              "If the weather looks bad, guests will be updated as needed.",
              "Answer naturally and gently, like a real person keeping someone in the loop.",
          ].join(" ")
        : mode === "bring_food"
          ? [
              "The guest wants to bring food, snacks, or drinks.",
              "Say that is welcome and offer the simple follow-up form naturally.",
          ].join(" ")
        : mode === "food_confirmation"
          ? [
              "The guest already said yes to sharing their food or drink details.",
              "Tell them to fill out the form and that the host will get the details.",
          ].join(" ")
        : mode === "party"
          ? [
                "Food, speakers, cards, and the basics for having a good time are already provided.",
                "If guests want to bring something extra, that's welcome too.",
                "Write a natural, friendly reply in one or two sentences.",
              ].join(" ")
            : [
                "This channel is only for party-related help.",
                "If the user is greeting or vague, reply warmly and invite them to ask a specific party question.",
                "If the user asks something unrelated to the party, politely redirect them back to party, venue, timing, parking, or food-request questions.",
                "Use English only.",
              ].join(" ");

  const replyStylePrompt = [
    "Prefer a conversational answer that feels like a friend helping out at the event desk.",
    "Do not use bullet points unless the user clearly asks for a list.",
    "Do not over-explain.",
    "If the user asks a simple question, answer in one short paragraph.",
  ].join(" ");

  const userPrompt = [
    `Customer name: ${customerName || "Unknown guest"}`,
    `User message: ${message}`,
    threadContext ? `Recent thread:\n${threadContext}` : "",
    `Greeting-like message: ${isGreeting ? "yes" : "no"}`,
    modePrompt,
    extraInstructions.length ? `Extra instructions:\n${extraInstructions.join("\n")}` : "",
    replyStylePrompt,
    "Respond with only the message text.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const reply = Array.isArray(content) ? content.join(" ") : String(content ?? "").trim();
    return ensureWeLead(reply || "");
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateSupportReason({
  message,
  customerName,
  existingThread = [],
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return buildReasonFallback({ message, existingThread });
  }

  const model = process.env.OPENAI_SUPPORT_MODEL || "gpt-4o-mini";
  const threadContext = summarizeThread(existingThread);

  const systemPrompt = [
    "You write the Reason line for a host alert about a guest support chat.",
    "Summarize the guest's underlying intent or issue, not the exact wording.",
    "Use one short sentence only.",
    "Keep it under 140 characters.",
    "If the guest has been chatting with the bot, use that context to refine the summary.",
    "Do not mention AI, the bot, or internal tools.",
  ].join(" ");

  const userPrompt = [
    `Customer name: ${customerName || "Unknown guest"}`,
    `Latest guest message: ${message}`,
    threadContext ? `Recent thread:\n${threadContext}` : "",
    "Return only the Reason text.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return buildReasonFallback({ message, existingThread });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const reason = Array.isArray(content) ? content.join(" ") : String(content ?? "").trim();
    return truncateText(reason || buildReasonFallback({ message, existingThread }), 140);
  } catch {
    return buildReasonFallback({ message, existingThread });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function parseSupportPayload(body) {
  const message = normalizeString(body?.message);
  const inviteToken = normalizePhoneNumber(body?.inviteToken ?? body?.phoneNumber);
  const ticketId = normalizeString(body?.ticketId);
  const requestType = normalizeString(body?.requestType);
  const contactName = normalizeString(body?.contactName);
  const contactPhoneNumber = normalizePhoneNumber(body?.contactPhoneNumber ?? body?.phoneNumber);
  const wantsHumanSupport = isHumanRequestMessage(message);

  if (!message) {
    throw new Error("message is required.");
  }

  return {
    message,
    inviteToken,
    ticketId,
    requestType,
    contactName,
    contactPhoneNumber,
    wantsHumanSupport,
  };
}

export async function buildSupportThread({ existingThread = [], message, customerName }) {
  const now = new Date().toISOString();
  const assistantMessage = (await buildAutoReply(message, customerName, existingThread)).answer;

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

export async function buildAutoReply(message, customerName, existingThread = []) {
  const normalized = normalizeString(message).toLowerCase();
  const topic = detectSupportTopic(message);
  const hasFoodRequestPrompt = [...existingThread]
    .reverse()
    .some(
      (entry) =>
        entry.role === "assistant" &&
        (normalizeString(entry.message).toLowerCase().includes("pass this along to the admin") ||
          normalizeString(entry.message).toLowerCase().includes("pass this along to the host")),
    );

  if (normalizeString(message).toLowerCase() === "request sent") {
    return {
      topic: "admin_request",
      answer: buildAdminRequestReply(),
      suggestedAction: "none",
    };
  }

  if (topic === "parking") {
    const aiReply = await generateSupportReply({
      mode: "parking",
      message,
      customerName,
      existingThread,
    });

    return {
      topic,
      answer: aiReply || buildParkingReply(),
      suggestedAction: "none",
    };
  }

  if (topic === "venue") {
    const aiReply = await generateSupportReply({
      mode: "venue",
      message,
      customerName,
      existingThread,
    });

    return {
      topic,
      answer: aiReply || buildVenueReply(),
      suggestedAction: "none",
    };
  }

  if (topic === "timing") {
    const aiReply = await generateSupportReply({
      mode: "timing",
      message,
      customerName,
      existingThread,
    });

    return {
      topic,
      answer: aiReply || buildTimingReply(),
      suggestedAction: "none",
    };
  }

  if (topic === "weather") {
    const aiReply = await generateSupportReply({
      mode: "weather",
      message,
      customerName,
      existingThread,
    });

    return {
      topic,
      answer: aiReply || buildWeatherReply(),
      suggestedAction: "none",
    };
  }

  if (topic === "bring_food") {
    const aiReply = await generateSupportReply({
      mode: "bring_food",
      message,
      customerName,
      existingThread,
    });

    return {
      topic,
      answer: aiReply || buildBringFoodReply(),
      suggestedAction: "food_request_confirmation",
    };
  }

  if (hasFoodRequestPrompt && isYesLikeMessage(normalized)) {
    const aiReply = await generateSupportReply({
      mode: "food_confirmation",
      message,
      customerName,
      existingThread,
    });

    return {
      topic: "food_request_confirmation",
      answer: aiReply || buildBringFoodConfirmationReply(),
      suggestedAction: "food_request_form",
    };
  }

  if (topic === "party") {
    const aiReply = await generateSupportReply({
      mode: "party",
      message,
      customerName,
      existingThread,
    });

    return {
      topic,
      answer: aiReply || buildPartyReply(),
      suggestedAction: "none",
    };
  }

  const aiReply = await generateSupportReply({
    mode: "general",
    message,
    customerName,
    existingThread,
  });

  return {
    topic: "general",
    answer: aiReply || buildGeneralReply(),
    suggestedAction: "none",
  };
}

export async function buildSupportReason(message, customerName, existingThread = []) {
  return generateSupportReason({
    message,
    customerName,
    existingThread,
  });
}

export async function buildSupportThreadTitle({
  message,
  question = "",
  answer = "",
  customerName = "",
  existingThread = [],
}) {
  return generateThreadTitle({
    message,
    question,
    answer,
    customerName,
    existingThread,
  });
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
    humanConnectionSmsSentAt: toISOString(data.humanConnectionSmsSentAt),
    humanTimeoutNoticeAt: toISOString(data.humanTimeoutNoticeAt),
    supportChatReadAt: toISOString(data.supportChatReadAt),
    supportChatActiveAt: toISOString(data.supportChatActiveAt),
    supportChatInactiveAt: toISOString(data.supportChatInactiveAt),
    supportChatState: String(data.supportChatState ?? ""),
    createdAt: toISOString(data.createdAt),
    updatedAt: toISOString(data.updatedAt),
    topic: String(data.topic ?? "general"),
    suggestedAction: String(data.suggestedAction ?? "none"),
    requestReason: String(data.requestReason ?? ""),
    ticketCode:
      normalizeTicketCode(data.ticketCode) ||
      buildTicketCodeFallback(id),
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
