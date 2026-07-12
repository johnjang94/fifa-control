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

function normalizeMimeType(fileName, mimeType) {
  const safeMimeType = typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "";
  if (safeMimeType) {
    return safeMimeType;
  }

  const extension = String(fileName ?? "")
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

function safeFileName(value) {
  return String(value ?? "profile-photo")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function storeProfilePhotoBuffer({
  buffer,
  fileName,
  mimeType,
  metadata = {},
}) {
  const safeMimeType = normalizeMimeType(fileName, mimeType);
  if (!["image/jpeg", "image/png", "image/webp"].includes(safeMimeType)) {
    throw new Error("Please upload a JPG, PNG, or WebP photo.");
  }

  const sizeLimitBytes = 50 * 1024 * 1024;
  const uploadBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  if (uploadBuffer.byteLength > sizeLimitBytes) {
    throw new Error("That photo is too large. Please use one under 50 MB.");
  }

  const bucket = getStorage(getFirebaseApp()).bucket(getStorageBucketName());
  const extension =
    safeMimeType === "image/jpeg" ? "jpg" : safeMimeType === "image/png" ? "png" : "webp";
  const objectPath = `invite-photos/${randomUUID()}-${safeFileName(fileName || "profile-photo") || "profile-photo"}.${extension}`;
  const token = randomUUID();
  const fileRef = bucket.file(objectPath);

  try {
    await fileRef.save(uploadBuffer, {
      resumable: false,
      metadata: {
        contentType: safeMimeType,
        metadata: {
          firebaseStorageDownloadTokens: token,
          originalFileName: fileName,
          ...Object.fromEntries(
            Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null),
          ),
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message.includes("The specified bucket does not exist") ||
      message.includes("No such bucket") ||
      message.includes("Not Found")
    ) {
      throw new Error(
        "Photo storage is not configured yet. Set FIREBASE_STORAGE_BUCKET to an existing Firebase Storage bucket.",
      );
    }

    throw error;
  }

  return {
    name: fileName,
    type: safeMimeType,
    size: uploadBuffer.byteLength,
    storageBucket: bucket.name,
    storagePath: objectPath,
    downloadToken: token,
    url: buildFirebaseStorageDownloadUrl(bucket.name, objectPath, token),
  };
}

export async function deleteProfilePhoto(profilePhoto) {
  const storageBucket = typeof profilePhoto?.storageBucket === "string" ? profilePhoto.storageBucket.trim() : "";
  const storagePath = typeof profilePhoto?.storagePath === "string" ? profilePhoto.storagePath.trim() : "";

  if (!storageBucket || !storagePath) {
    return false;
  }

  const bucket = getStorage(getFirebaseApp()).bucket(storageBucket);
  const fileRef = bucket.file(storagePath);

  try {
    await fileRef.delete({ ignoreNotFound: true });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message.includes("The specified bucket does not exist") ||
      message.includes("No such bucket") ||
      message.includes("Not Found")
    ) {
      return false;
    }

    throw error;
  }
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
  const buffer = Buffer.from(await file.arrayBuffer());
  return storeProfilePhotoBuffer({
    buffer,
    fileName: file.name,
    mimeType: resolveProfilePhotoType(file),
  });
}

function pickOne(options) {
  return options[Math.floor(Math.random() * options.length)];
}

function buildAiPortraitPrompt() {
  const personType = pickOne([
    "an anonymous adult event guest",
    "a friendly adult attendee",
    "a relaxed adult watcher",
    "a stylish adult fan",
  ]);
  const expression = pickOne([
    "soft smile",
    "calm neutral expression",
    "warm friendly smile",
    "natural candid expression",
  ]);
  const wardrobe = pickOne([
    "casual dark top with clean lines",
    "simple light shirt",
    "neutral smart-casual outfit",
    "clean modern streetwear",
  ]);
  const background = pickOne([
    "soft studio gray background",
    "subtle warm beige background",
    "clean dark gradient background",
    "muted modern portrait backdrop",
  ]);
  const lighting = pickOne([
    "soft diffused lighting",
    "even studio lighting",
    "gentle natural light",
    "balanced portrait lighting",
  ]);

  return [
    `Photorealistic vertical profile photo of ${personType}.`,
    `The person should look like a real, everyday guest, with a ${expression}, ${wardrobe}, ${background}, and ${lighting}.`,
    "Keep the image tasteful, elevated, and visually clean, with natural skin texture and balanced contrast.",
    "No text, no watermark, no celebrity resemblance, no exaggerated features, and no obvious AI artifacts.",
    "Frame it like a genuine premium social profile portrait.",
  ].join(" ");
}

async function generateOpenAiImageBuffer(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("AI photo generation is not configured yet. Set OPENAI_API_KEY.");
  }

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        size: "1024x1024",
        response_format: "b64_json",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        errorText
          ? `AI photo generation failed: ${errorText}`
          : "AI photo generation failed.",
      );
    }

    const data = await response.json();
    const image = Array.isArray(data?.data) ? data.data[0] : null;
    const b64Json = typeof image?.b64_json === "string" ? image.b64_json : "";
    const imageUrl = typeof image?.url === "string" ? image.url : "";
    const mimeType =
      typeof image?.mime_type === "string" && image.mime_type.trim()
        ? image.mime_type.trim().toLowerCase()
        : "image/png";

    if (b64Json) {
      return {
        buffer: Buffer.from(b64Json, "base64"),
        mimeType,
      };
    }

    if (imageUrl) {
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error("AI photo generation failed while downloading the image.");
      }

      return {
        buffer: Buffer.from(await imageResponse.arrayBuffer()),
        mimeType:
          imageResponse.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ||
          mimeType,
      };
    }

    throw new Error("AI photo generation did not return an image.");
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function storeGeneratedProfilePhoto() {
  const prompt = buildAiPortraitPrompt();
  const generatedImage = await generateOpenAiImageBuffer(prompt);
  const fileName = "ai-profile-photo.png";
  const storedPhoto = await storeProfilePhotoBuffer({
    buffer: generatedImage.buffer,
    fileName,
    mimeType: generatedImage.mimeType,
    metadata: {
      aiGenerated: "true",
      aiTag: "AI",
      aiProvider: "openai",
      aiModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      originalFileName: fileName,
      generationPrompt: prompt,
    },
  });

  return {
    ...storedPhoto,
    aiGenerated: true,
    aiTag: "AI",
    aiProvider: "openai",
    aiModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
    generationPrompt: prompt,
  };
}
