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

function isYesLikeMessage(message) {
  const normalized = normalizeString(message).toLowerCase();
  return /^(yes|yeah|yep|sure|ok|okay|please do|of course|absolutely|go ahead|sounds good|네|예|응|그래|좋아|좋습니다)\b/.test(
    normalized,
  );
}

function isBringFoodIntent(message) {
  const normalized = normalizeString(message).toLowerCase();
  return (
    /bring.*(food|snack|bbq|dish|item)/i.test(normalized) ||
    /(food|snack|bbq|dish|item).*(bring|bring along|take)/i.test(normalized) ||
    /i can bring/i.test(normalized) ||
    /want to bring/i.test(normalized) ||
    /would like to bring/i.test(normalized) ||
    /food.*bring/i.test(normalized) ||
    /snack.*bring/i.test(normalized) ||
    /bbq.*bring/i.test(normalized) ||
    /가져오/.test(normalized) ||
    /가져가/.test(normalized) ||
    /음식.*(가져오|가져가)/.test(normalized) ||
    /가져오고 싶/.test(normalized) ||
    /희망/.test(normalized)
  );
}

function detectSupportTopic(message) {
  const normalized = normalizeString(message).toLowerCase();

  if (/parking|park|주차|차량|차/i.test(normalized)) {
    return "parking";
  }

  if (/venue|address|location|where|place|어디|주소|장소/i.test(normalized)) {
    return "venue";
  }

  if (/time|when|schedule|timing|몇 시|언제|일정|오픈|close|closing|start|end/i.test(normalized)) {
    return "timing";
  }

  if (/party|food|drink|drinks|beverage|bbq|snack|menu|potluck|음식|술|음료|파티/i.test(normalized)) {
    return isBringFoodIntent(normalized) ? "bring_food" : "party";
  }

  return "general";
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
    "Parking options are:",
    "1. 15 Lower Jarvis has a Loblaw where you can park.",
    "2. Green P Parking is near St. Lawrence Market.",
    "3. Guest parking is available in the building.",
  ].join(" ");
}

function buildVenueReply() {
  return "The venue is 138 Downes Street, Toronto, ON.";
}

function buildTimingReply() {
  return "The party is on Sunday, July 19, 2026 from 12:00 pm till 5:00 pm.";
}

function buildPartyReply() {
  return [
    "Food, speakers, cards, and the basics for having a good time are already provided.",
    "If you'd like to bring something extra, that's welcome too.",
  ].join(" ");
}

function buildBringFoodReply() {
  return "Absolutely. Extra food or anything else you'd like to bring is welcome. I’ll show a quick form so you can send the details.";
}

function buildBringFoodConfirmationReply() {
  return "Perfect. Please fill out the form below and submit it so we can pass the details to the host.";
}

function buildGeneralReply() {
  return "I can help with party, venue, timing, and parking questions. If it's something else, the host can help continue the conversation.";
}

function buildAdminRequestReply() {
  return "Thanks. Your request has been sent to the host.";
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
  const threadContext = summarizeThread(existingThread);
  const isGreeting = normalizeString(message).length <= 12;
  const systemPrompt = [
    "You are a warm, concise support assistant for a FIFA half-time watch party.",
    "Do not mention policies, rules, or internal tooling unless the user asks directly.",
    "Never say you are an AI.",
    "Keep replies short, natural, and helpful.",
  ].join(" ");

  const modePrompt =
    mode === "parking"
      ? [
          "The venue address is 138 Downes Street, Toronto, ON.",
          "Helpful parking guidance: 15 Lower Jarvis has a Loblaw where guests can park, Green P Parking is near St. Lawrence Market, and guest parking is available in the building.",
          "Rewrite the parking guidance in a polished, friendly tone.",
        ].join(" ")
      : [
          "This channel is only for party-related help.",
          "If the user is greeting or vague, reply warmly and invite them to ask a specific party question.",
          "If the user asks something unrelated to the party, politely redirect them back to party, venue, timing, parking, or food-request questions.",
        ].join(" ");

  const userPrompt = [
    `Customer name: ${customerName || "Unknown guest"}`,
    `User message: ${message}`,
    threadContext ? `Recent thread:\n${threadContext}` : "",
    `Greeting-like message: ${isGreeting ? "yes" : "no"}`,
    modePrompt,
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
    return {
      topic,
      answer: buildVenueReply(),
      suggestedAction: "none",
    };
  }

  if (topic === "timing") {
    return {
      topic,
      answer: buildTimingReply(),
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
    return {
      topic,
      answer: buildPartyReply(),
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
    thread,
  };
}

export function isHumanRequest(message) {
  return isHumanRequestMessage(message);
}
