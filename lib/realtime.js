const relayBaseUrl =
  process.env.WS_RELAY_URL ?? "https://fifa-realtime.onrender.com";
const relaySecret = process.env.WS_RELAY_SECRET ?? "proof-watch-party-realtime-relay";

function normalize(value) {
  return String(value ?? "").trim();
}

function buildRelayUrl(pathname) {
  return new URL(pathname, relayBaseUrl).toString();
}

export async function publishRealtimeInquiryUpdate(roomId, inquiry) {
  const safeRoomId = normalize(roomId);
  if (!safeRoomId || !normalize(relaySecret)) {
    return;
  }

  try {
    await fetch(buildRelayUrl("/publish"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-relay-secret": relaySecret,
      },
      body: JSON.stringify({
        room: safeRoomId,
        event: {
          type: "inquiry.updated",
          room: safeRoomId,
          inquiry,
          publishedAt: new Date().toISOString(),
        },
      }),
    });
  } catch {
    // Realtime delivery is best effort; the database remains the source of truth.
  }
}
