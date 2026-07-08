import { Timestamp } from "firebase-admin/firestore";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseInvitePayload(formData) {
  const firstName = normalizeString(formData.get("firstName"));
  const lastName = normalizeString(formData.get("lastName"));
  const phoneNumber = normalizeString(formData.get("phoneNumber"));
  const profilePhoto = formData.get("profilePhoto");

  if (!firstName || !lastName || !phoneNumber) {
    throw new Error("Please fill in first name, last name, and phone number.");
  }

  const profilePhotoPayload =
    profilePhoto instanceof File && profilePhoto.size > 0
      ? {
          name: profilePhoto.name,
          type: profilePhoto.type,
          size: profilePhoto.size,
        }
      : null;

  return {
    firstName,
    lastName,
    phoneNumber,
    profilePhoto: profilePhotoPayload,
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
    firstName: String(data.firstName ?? ""),
    lastName: String(data.lastName ?? ""),
    phoneNumber: String(data.phoneNumber ?? ""),
    profilePhoto: data.profilePhoto ?? null,
    createdAt: timestamp,
  };
}
