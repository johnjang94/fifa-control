import { Timestamp } from "firebase-admin/firestore";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toDataUrl(file) {
  return file.arrayBuffer().then((buffer) => {
    const mimeType = normalizeString(file.type) || "application/octet-stream";
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

  const profilePhotoPayload =
    profilePhoto instanceof File && profilePhoto.size > 0
      ? {
          name: profilePhoto.name,
          type: profilePhoto.type,
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
    enteredAt: toISOString(data.enteredAt ?? data.deviceTrackedAt ?? data.createdAt),
    registeredAt: toISOString(data.registeredAt ?? data.submittedAt ?? data.createdAt),
    status: String(data.status ?? ""),
    createdAt: timestamp,
  };
}
