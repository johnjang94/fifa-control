import { Timestamp } from "firebase-admin/firestore";

const MAX_PROFILE_PHOTO_BYTES = 650 * 1024;
const SUPPORTED_PROFILE_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const NAME_PATTERN = /^[A-Za-z]{2,}$/;
const PHONE_PATTERN = /^\d{10}$/;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveProfilePhotoType(file) {
  const mimeType = normalizeString(file?.type).toLowerCase();
  if (mimeType) {
    return mimeType;
  }

  const extension = String(file?.name ?? "")
    .split(".")
    .pop()
    ?.toLowerCase();

  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }

  if (extension === "png") {
    return "image/png";
  }

  if (extension === "webp") {
    return "image/webp";
  }

  return "";
}

function isUploadableProfilePhoto(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.arrayBuffer === "function" &&
      typeof value.size === "number" &&
      value.size > 0 &&
      typeof value.name === "string",
  );
}

function toDataUrl(file) {
  const mimeType = resolveProfilePhotoType(file);

  if (!SUPPORTED_PROFILE_PHOTO_TYPES.has(mimeType)) {
    throw new Error("Please upload a JPG, PNG, or WebP photo.");
  }

  if (file.size > MAX_PROFILE_PHOTO_BYTES) {
    throw new Error("That photo is too large. Please use one under 650 KB.");
  }

  return file.arrayBuffer().then((buffer) => {
    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${mimeType};base64,${base64}`;
  });
}

function toISOString(value) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  return new Date().toISOString();
}

export async function parseInvitePayload(formData) {
  const firstName = normalizeString(formData.get("firstName"));
  const lastName = normalizeString(formData.get("lastName"));
  const phoneNumber = normalizeString(formData.get("phoneNumber"));
  const profilePhoto = formData.get("profilePhoto");

  if (!firstName || !lastName || !phoneNumber) {
    throw new Error("Please fill in first name, last name, and phone number.");
  }

  if (!NAME_PATTERN.test(firstName)) {
    throw new Error("Please enter at least 2 letters for the first name.");
  }

  if (!NAME_PATTERN.test(lastName)) {
    throw new Error("Please enter at least 2 letters for the last name.");
  }

  if (!PHONE_PATTERN.test(phoneNumber.replace(/\D/g, ""))) {
    throw new Error("Please enter a 10-digit phone number, like 5551234567.");
  }

  const profilePhotoPayload =
      isUploadableProfilePhoto(profilePhoto)
      ? {
          name: profilePhoto.name,
          type: resolveProfilePhotoType(profilePhoto),
          size: profilePhoto.size,
          url: await toDataUrl(profilePhoto),
        }
      : null;

  return {
    firstName,
    lastName,
    phoneNumber,
    profilePhoto: profilePhotoPayload,
    profilePhotoUrl: profilePhotoPayload?.url ?? null,
  };
}

export function toInviteRequest(id, data) {
  const createdAt = data.createdAt;
  const timestamp =
    createdAt instanceof Timestamp
      ? createdAt.toDate().toISOString()
      : typeof createdAt === "string"
        ? createdAt
        : new Date().toISOString();

  return {
    id,
    qrToken: id,
    firstName: String(data.firstName ?? ""),
    lastName: String(data.lastName ?? ""),
    phoneNumber: String(data.phoneNumber ?? ""),
    profilePhoto: data.profilePhoto ?? null,
    profilePhotoUrl:
      typeof data.profilePhotoUrl === "string"
        ? data.profilePhotoUrl
        : typeof data.profilePhoto?.url === "string"
          ? data.profilePhoto.url
          : null,
    attendance: String(data.attendance ?? data.status ?? ""),
    rsvp: String(data.rsvp ?? "Going"),
    enteredAt: toISOString(data.enteredAt ?? data.deviceTrackedAt ?? data.createdAt),
    registeredAt: toISOString(data.registeredAt ?? data.submittedAt ?? data.createdAt),
    status: String(data.status ?? ""),
    createdAt: timestamp,
  };
}
