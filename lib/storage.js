import "server-only";

import { randomUUID } from "crypto";
import { getStorage } from "firebase-admin/storage";

import { getFirebaseApp, getFirebaseProjectId } from "./firebase-admin";

const STORAGE_BUCKET_ENV_KEYS = [
  "FIREBASE_STORAGE_BUCKET",
  "GCLOUD_STORAGE_BUCKET",
  "FIREBASE_BUCKET_NAME",
];

function getStorageBucketName() {
  for (const key of STORAGE_BUCKET_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return `${getFirebaseProjectId()}.appspot.com`;
}

function encodeStoragePath(path) {
  return String(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function buildFirebaseStorageDownloadUrl(bucketName, objectPath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeStoragePath(objectPath)}?alt=media&token=${encodeURIComponent(token)}`;
}

function resolveProfilePhotoType(file) {
  const mimeType = typeof file.type === "string" ? file.type.trim().toLowerCase() : "";
  if (mimeType) {
    return mimeType;
  }

  const extension = String(file.name ?? "")
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

export function isUploadableProfilePhoto(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.arrayBuffer === "function" &&
      typeof value.size === "number" &&
      value.size > 0 &&
      typeof value.name === "string",
  );
}

export async function storeProfilePhoto(file) {
  const mimeType = resolveProfilePhotoType(file);
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw new Error("Please upload a JPG, PNG, or WebP photo.");
  }

  const sizeLimitBytes = 50 * 1024 * 1024;
  if (file.size > sizeLimitBytes) {
    throw new Error("That photo is too large. Please use one under 50 MB.");
  }

  const bucket = getStorage(getFirebaseApp()).bucket(getStorageBucketName());
  const safeName = String(file.name ?? "profile-photo")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp";
  const objectPath = `invite-photos/${randomUUID()}-${safeName || "profile-photo"}.${extension}`;
  const token = randomUUID();
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileRef = bucket.file(objectPath);

  await fileRef.save(buffer, {
    resumable: false,
    metadata: {
      contentType: mimeType,
      metadata: {
        firebaseStorageDownloadTokens: token,
        originalFileName: file.name,
      },
    },
  });

  return {
    name: file.name,
    type: mimeType,
    size: file.size,
    storageBucket: bucket.name,
    storagePath: objectPath,
    downloadToken: token,
    url: buildFirebaseStorageDownloadUrl(bucket.name, objectPath, token),
  };
}
