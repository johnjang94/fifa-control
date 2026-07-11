function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhoneNumber(value) {
  return normalizeString(value).replace(/\D/g, "");
}

function normalizeTwilioPhoneNumber(value) {
  const normalized = normalizeString(value).replace(/[^\d+]/g, "");
  if (normalized.startsWith("+")) {
    return normalized;
  }

  const digits = normalized.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  return digits ? `+${digits}` : "";
}

function splitRecipients(value) {
  return normalizeString(value)
    .split(/[,\s]+/)
    .map((item) => normalizeTwilioPhoneNumber(item))
    .filter(Boolean);
}

function buildTwilioBody({ to, from, message }) {
  const params = new URLSearchParams();
  params.set("To", to);
  params.set("From", from);
  params.set("Body", message);
  return params;
}

async function sendTwilioMessage({ to, message }) {
  const accountSid = normalizeString(process.env.TWILIO_ACCOUNT_SID);
  const authToken = normalizeString(process.env.TWILIO_AUTH_TOKEN);
  const fromNumber = normalizeTwilioPhoneNumber(process.env.TWILIO_FROM_NUMBER);
  const recipient = normalizeTwilioPhoneNumber(to);
  const body = normalizeString(message);

  if (!accountSid || !authToken || !fromNumber || !recipient || !body) {
    return { ok: false, skipped: true };
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: buildTwilioBody({
      to: recipient,
      from: fromNumber,
      message: body,
    }).toString(),
  });

  const data = await response.json().catch(() => ({}));

  return {
    ok: response.ok,
    sid: data.sid ?? null,
    error: data.message ?? data.error_message ?? null,
  };
}

export function getSupportSmsRecipients() {
  return splitRecipients(process.env.SUPPORT_ALERT_TO_NUMBER);
}

export function hasTwilioConfig() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER &&
      getSupportSmsRecipients().length,
  );
}

export async function sendSupportSms(message) {
  const recipients = getSupportSmsRecipients();
  const body = normalizeString(message);

  if (!recipients.length || !body) {
    return { ok: false, skipped: true };
  }

  const results = [];

  for (const recipient of recipients) {
    const result = await sendTwilioMessage({ to: recipient, message: body });
    results.push({
      to: recipient,
      ok: result.ok,
      sid: result.sid ?? null,
      error: result.error ?? null,
    });
  }

  return { ok: results.every((item) => item.ok), results };
}

export async function sendTextSms({ to, message }) {
  return sendTwilioMessage({ to, message });
}
