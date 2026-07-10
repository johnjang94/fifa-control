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
  return [
    "A few easy parking options: 15 Lower Jarvis has a Loblaw where you can park, Green P Parking is near St. Lawrence Market, and there is guest parking in the building too.",
  ].join(" ");
}

function buildVenueReply() {
  return "It is at 138 Downes Street, Toronto, ON M5E 0E4.";
}

function buildTimingReply() {
  return "The party is on Sunday, July 19, 2026 from 12:00 pm to 5:00 pm.";
}

function buildPartyReply() {
  return [
    "Food, speakers, cards, and the basics are already covered.",
    "If you want to bring something extra, that is totally fine.",
  ].join(" ");
}

function buildBringFoodReply() {
  return "Sure thing. Extra food or anything else you want to bring is welcome. I’ll bring up a quick form so you can send the details.";
}

function buildBringFoodConfirmationReply() {
  return "Perfect. Fill out the form below and send it over, and we will pass the details to the host.";
}

function buildGeneralReply() {
  return "I can help with party, venue, timing, parking, or food questions. If you meant something else, just ask and I will point you in the right direction.";
}

function buildEnglishOnlyReply() {
  return "Please send that in English and I will jump in right away.";
}

function buildAdminRequestReply() {
  return "Got it. I sent that to the host.";
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

async function generateSupportReply({
  mode,
  message,
  customerName,
  existingThread = [],
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
    "Keep replies short, human, and easy to read.",
  ].join(" ");

  const modePrompt =
    mode === "parking"
      ? [
          "The venue address is 138 Downes Street, Toronto, ON.",
          "Helpful parking guidance: 15 Lower Jarvis has a Loblaw where guests can park, Green P Parking is near St. Lawrence Market, and guest parking is available in the building.",
          "Write a polished, friendly reply that sounds human.",
        ].join(" ")
      : mode === "venue"
        ? [
            "The venue address is 138 Downes Street, Toronto, ON M5E 0E4.",
            "Write a natural, friendly reply that shares the venue information in one or two sentences.",
          ].join(" ")
        : mode === "timing"
          ? [
              "The party is on Sunday, July 19, 2026 from 12:00 pm till 5:00 pm.",
              "Write a natural, friendly reply that shares the party time in one or two sentences.",
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
    return reply || null;
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

  if (topic === "bring_food") {
    return {
      topic,
      answer: buildBringFoodReply(),
      suggestedAction: "food_request_confirmation",
    };
  }

  if (hasFoodRequestPrompt && isYesLikeMessage(normalized)) {
    return {
      topic: "food_request_confirmation",
      answer: buildBringFoodConfirmationReply(),
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
    createdAt: toISOString(data.createdAt),
    updatedAt: toISOString(data.updatedAt),
    topic: String(data.topic ?? "general"),
    suggestedAction: String(data.suggestedAction ?? "none"),
    requestReason: String(data.requestReason ?? ""),
    thread,
  };
}

export function isHumanRequest(message) {
  return isHumanRequestMessage(message);
}
