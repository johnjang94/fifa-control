const HUMAN_RESPONSE_TIMEOUT_MS = 30 * 1000;
const HUMAN_TIMEOUT_NOTICE_MESSAGE =
  "Sorry. All of our admins are currently helping other guests. We will let you know as soon as someone responds.";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toTimestamp(value) {
  if (!value) {
    return 0;
  }

  if (typeof value === "string") {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  if (typeof value.toDate === "function") {
    const timestamp = value.toDate().getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  return 0;
}

function getThread(data) {
  return Array.isArray(data?.thread) ? data.thread : [];
}

function hasTimeoutNotice(thread) {
  return thread.some(
    (item) => normalizeString(item?.message) === HUMAN_TIMEOUT_NOTICE_MESSAGE,
  );
}

export function getHumanTimeoutNoticeMessage() {
  return HUMAN_TIMEOUT_NOTICE_MESSAGE;
}

export function shouldAppendHumanTimeoutNotice(data, now = Date.now()) {
  const requestedAt = toTimestamp(data?.humanRequestedAt);
  if (!requestedAt) {
    return false;
  }

  if (toTimestamp(data?.humanAcknowledgedAt)) {
    return false;
  }

  if (toTimestamp(data?.humanTimeoutNoticeAt)) {
    return false;
  }

  if (now - requestedAt < HUMAN_RESPONSE_TIMEOUT_MS) {
    return false;
  }

  return !hasTimeoutNotice(getThread(data));
}

export function appendHumanTimeoutNotice(data, now = new Date()) {
  const thread = getThread(data);
  const nextThread = [
    ...thread,
    {
      role: "assistant",
      message: HUMAN_TIMEOUT_NOTICE_MESSAGE,
      createdAt: now,
    },
  ];

  return {
    ...data,
    thread: nextThread,
    answer: HUMAN_TIMEOUT_NOTICE_MESSAGE,
    humanTimeoutNoticeAt: now,
    updatedAt: now,
  };
}

export function maybeAppendHumanTimeoutNotice(data, now = new Date()) {
  if (!shouldAppendHumanTimeoutNotice(data, now.getTime())) {
    return {
      data,
      appended: false,
    };
  }

  return {
    data: appendHumanTimeoutNotice(data, now),
    appended: true,
  };
}
