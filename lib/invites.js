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

function toOptionalISOString(value) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  return "";
}

function normalizeSurvey(data) {
  const survey = data.survey ?? {};
  const howDidYouKnow = String(survey.howDidYouKnow ?? data.howDidYouKnow ?? "").trim();
  const referredBy = String(survey.referredBy ?? data.referredBy ?? "").trim();
  const dietaryRestrictions = String(survey.dietaryRestrictions ?? data.dietaryRestrictions ?? "").trim();
  const resident = String(survey.resident ?? data.resident ?? "").trim();
  const submittedAt =
    toOptionalISOString(survey.submittedAt ?? data.surveyCompletedAt ?? data.surveySubmittedAt) ||
    "";

  if (!howDidYouKnow && !referredBy && !dietaryRestrictions && !resident && !submittedAt) {
    return null;
  }

  return {
    howDidYouKnow,
    referredBy,
    dietaryRestrictions,
    resident,
    submittedAt,
  };
}

export async function parseInvitePayload(formData) {
  const firstName = normalizeString(formData.get("firstName"));
  const lastName = normalizeString(formData.get("lastName"));
  const phoneNumber = normalizeString(formData.get("phoneNumber"));
  const profilePhoto = formData.get("profilePhoto");
  const privacyPolicyAccepted = String(formData.get("privacyAccepted") ?? "").toLowerCase() === "on";

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

  const hasUploadedProfilePhoto = isUploadableProfilePhoto(profilePhoto);
  const profilePhotoPayload = hasUploadedProfilePhoto ? await storeProfilePhoto(profilePhoto) : null;

  return {
    firstName,
    lastName,
    phoneNumber,
    profilePhoto: profilePhotoPayload,
    profilePhotoUrl: profilePhotoPayload?.url ?? null,
    profilePhotoTag: profilePhotoPayload?.aiTag ?? "",
    profilePhotoAiGenerated: Boolean(profilePhotoPayload?.aiGenerated ?? false),
    privacyPolicyAccepted,
    privacyPolicyAcceptedAt: privacyPolicyAccepted ? new Date().toISOString() : "",
  };
}

export function buildWelcomeSmsMessage(firstName) {
  const safeFirstName = String(firstName ?? "").trim() || "there";
  return `Hi ${safeFirstName}, we are reaching out to you from FIFA Final X BTS Half-Time Show Watch Party. We are pleased that you are interested in joining us! Due to limited capacity, we are just trying to accommodate everyone. Please stay tuned for more information!`;
}

export function toInviteRequest(id, data) {
  const createdAt = data.createdAt;
  const profilePhoto = data.profilePhoto ?? null;
  const survey = normalizeSurvey(data);
  const welcomeSmsSentAt = toOptionalISOString(data.welcomeSmsSentAt ?? data.welcomeSmsResentAt ?? "");
  const privacyPolicyAccepted = Boolean(
    data.privacyPolicyAccepted ?? data.privacyAccepted ?? false,
  );
  const privacyPolicyAcceptedAt = toOptionalISOString(
    data.privacyPolicyAcceptedAt ?? data.privacyAcceptedAt ?? data.privacyConsentAt ?? "",
  );
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
  const profilePhotoTag =
    typeof data.profilePhotoTag === "string"
      ? data.profilePhotoTag
      : typeof profilePhoto?.aiTag === "string"
        ? profilePhoto.aiTag
        : "";
  const profilePhotoAiGenerated = Boolean(data.profilePhotoAiGenerated ?? profilePhoto?.aiGenerated ?? false);

  const timestamp =
    createdAt instanceof Timestamp
      ? createdAt.toDate().toISOString()
      : typeof createdAt === "string"
        ? createdAt
        : new Date().toISOString();

  return {
    id,
    qrToken: id,
    barcode: String(data.barcode ?? ""),
    firstName: String(data.firstName ?? ""),
    lastName: String(data.lastName ?? ""),
    phoneNumber: String(data.phoneNumber ?? ""),
    profilePhoto,
    profilePhotoUrl,
    profilePhotoTag,
    profilePhotoAiGenerated,
    attendance: String(data.attendance ?? data.status ?? ""),
    rsvp: String(data.rsvp ?? "Going"),
    checkedInAt: toOptionalISOString(data.checkedInAt ?? data.checked_in_at ?? ""),
    survey,
    surveyCompletedAt: toOptionalISOString(data.surveyCompletedAt ?? data.survey?.submittedAt ?? data.surveySubmittedAt ?? ""),
    welcomeSmsAttemptedAt: toOptionalISOString(data.welcomeSmsAttemptedAt ?? ""),
    welcomeSmsDeliveryStatus: String(data.welcomeSmsDeliveryStatus ?? ""),
    welcomeSmsErrorMessage: String(data.welcomeSmsErrorMessage ?? ""),
    welcomeSmsMessage: String(data.welcomeSmsMessage ?? ""),
    welcomeSmsResentAt: toOptionalISOString(data.welcomeSmsResentAt ?? ""),
    welcomeSmsResendCount: Number(data.welcomeSmsResendCount ?? 0) || 0,
    welcomeSmsSentAt,
    welcomeSmsSid: String(data.welcomeSmsSid ?? ""),
    privacyPolicyAccepted,
    privacyPolicyAcceptedAt,
    enteredAt: toISOString(data.enteredAt ?? data.deviceTrackedAt ?? data.createdAt),
    registeredAt: toISOString(data.registeredAt ?? data.submittedAt ?? data.createdAt),
    status: String(data.status ?? ""),
    createdAt: timestamp,
  };
}
