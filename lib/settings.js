import "server-only";

import { buildFirebaseStorageDownloadUrl, deleteProfilePhoto, storeProfilePhoto } from "./storage";

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

function normalizeStoredPhoto(photo) {
  if (!photo || typeof photo !== "object") {
    return null;
  }

  const storageBucket = typeof photo.storageBucket === "string" ? photo.storageBucket.trim() : "";
  const storagePath = typeof photo.storagePath === "string" ? photo.storagePath.trim() : "";
  const downloadToken = typeof photo.downloadToken === "string" ? photo.downloadToken.trim() : "";

  if (!storageBucket || !storagePath) {
    return null;
  }

  const url =
    typeof photo.url === "string" && photo.url.trim()
      ? photo.url.trim()
      : downloadToken
        ? buildFirebaseStorageDownloadUrl(storageBucket, storagePath, downloadToken)
        : null;

  return {
    name: typeof photo.name === "string" ? photo.name : "",
    type: typeof photo.type === "string" ? photo.type : "",
    size: Number(photo.size ?? 0) || 0,
    storageBucket,
    storagePath,
    downloadToken,
    url,
    aiGenerated: Boolean(photo.aiGenerated ?? false),
    aiTag: typeof photo.aiTag === "string" ? photo.aiTag : "",
    aiProvider: typeof photo.aiProvider === "string" ? photo.aiProvider : "",
    aiModel: typeof photo.aiModel === "string" ? photo.aiModel : "",
    generationPrompt: typeof photo.generationPrompt === "string" ? photo.generationPrompt : "",
  };
}

function toInviteSettings(data) {
  const rawCapacity = data?.inviteCapacity;
  const capacity =
    rawCapacity === null || rawCapacity === undefined ? null : Number(rawCapacity);
  const profilePhoto = normalizeStoredPhoto(data?.profilePhoto);
  const bannerPhoto = normalizeStoredPhoto(data?.bannerPhoto);

  return {
    capacity:
      Number.isInteger(capacity) && capacity > 0
        ? capacity
        : null,
    profilePhoto,
    bannerPhoto,
    profilePhotoUrl: profilePhoto?.url ?? null,
    bannerPhotoUrl: bannerPhoto?.url ?? null,
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
      profilePhoto: null,
      bannerPhoto: null,
      profilePhotoUrl: null,
      bannerPhotoUrl: null,
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

async function setInvitePhoto(db, kind, file) {
  if (!["profilePhoto", "bannerPhoto"].includes(kind)) {
    throw new Error("Unsupported photo kind.");
  }

  const currentSettings = await getInviteSettings(db);
  const previousPhoto = currentSettings[kind];
  const uploadedPhoto = await storeProfilePhoto(file);
  const ref = db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC);

  await ref.set(
    {
      [kind]: uploadedPhoto,
      updatedAt: new Date(),
    },
    { merge: true },
  );

  if (
    previousPhoto?.storageBucket &&
    previousPhoto?.storagePath &&
    (previousPhoto.storageBucket !== uploadedPhoto.storageBucket ||
      previousPhoto.storagePath !== uploadedPhoto.storagePath)
  ) {
    await deleteProfilePhoto(previousPhoto);
  }

  return getInviteSettings(db);
}

export { getInviteSettings, setInviteCapacity, setInvitePhoto, toInviteSettings };
