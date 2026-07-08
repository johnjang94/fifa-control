import "server-only";

const SETTINGS_COLLECTION = "app_settings";
const SETTINGS_DOC = "invite_config";

function parseCapacityValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const capacity = Number(value);
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error("Capacity must be a positive whole number.");
  }

  return capacity;
}

function toInviteSettings(data) {
  const rawCapacity = data?.inviteCapacity;
  const capacity =
    rawCapacity === null || rawCapacity === undefined ? null : Number(rawCapacity);

  return {
    capacity:
      Number.isInteger(capacity) && capacity > 0
        ? capacity
        : null,
    updatedAt:
      typeof data?.updatedAt?.toDate === "function"
        ? data.updatedAt.toDate().toISOString()
        : typeof data?.updatedAt === "string"
          ? data.updatedAt
          : null,
  };
}

async function getInviteSettings(db) {
  const snapshot = await db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC).get();
  if (!snapshot.exists) {
    return {
      capacity: null,
      updatedAt: null,
    };
  }

  return toInviteSettings(snapshot.data());
}

async function setInviteCapacity(db, input) {
  const capacity = parseCapacityValue(input);
  const ref = db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC);

  await ref.set(
    {
      inviteCapacity: capacity,
      updatedAt: new Date(),
    },
    { merge: true },
  );

  return {
    capacity,
    updatedAt: new Date().toISOString(),
  };
}

export { getInviteSettings, setInviteCapacity, toInviteSettings };
