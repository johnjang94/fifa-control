import { Timestamp } from "firebase-admin/firestore";

import {
  buildFirebaseStorageDownloadUrl,
  isUploadableProfilePhoto,
  storeProfilePhoto,
} from "./storage";

const NAME_PATTERN = /^[A-Za-z]{2,}$/;
const PHONE_PATTERN = /^\d{10}$/;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
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
    isUploadableProfilePhoto(profilePhoto) ? await storeProfilePhoto(profilePhoto) : null;

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
  const profilePhoto = data.profilePhoto ?? null;
  const profilePhotoUrl =
    typeof data.profilePhotoUrl === "string"
      ? data.profilePhotoUrl
      : typeof profilePhoto?.url === "string"
        ? profilePhoto.url
        : typeof profilePhoto?.storageBucket === "string" &&
            typeof profilePhoto?.storagePath === "string" &&
            typeof profilePhoto?.downloadToken === "string"
          ? buildFirebaseStorageDownloadUrl(
              profilePhoto.storageBucket,
              profilePhoto.storagePath,
              profilePhoto.downloadToken,
            )
          : null;

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
    profilePhoto,
    profilePhotoUrl,
    attendance: String(data.attendance ?? data.status ?? ""),
    rsvp: String(data.rsvp ?? "Going"),
    enteredAt: toISOString(data.enteredAt ?? data.deviceTrackedAt ?? data.createdAt),
    registeredAt: toISOString(data.registeredAt ?? data.submittedAt ?? data.createdAt),
    status: String(data.status ?? ""),
    createdAt: timestamp,
  };
}
