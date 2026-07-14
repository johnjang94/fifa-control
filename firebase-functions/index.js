const admin = require("firebase-admin");
const { onDocumentDeleted } = require("firebase-functions/v2/firestore");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();
const INVITE_COLLECTION = "invite_requests";
const INQUIRY_COLLECTION = "support_chat_inquiries";
const LEGACY_INQUIRY_COLLECTION = "guest_faq_inquiries";
const DELETE_BATCH_SIZE = 400;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function deleteMatchingDocs(query) {
  while (true) {
    const snapshot = await query.limit(DELETE_BATCH_SIZE).get();
    if (snapshot.empty) {
      break;
    }

    const batch = db.batch();
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }
}

async function deleteProfilePhoto(profilePhoto) {
  const storageBucket = normalizeString(profilePhoto?.storageBucket);
  const storagePath = normalizeString(profilePhoto?.storagePath);

  if (!storageBucket || !storagePath) {
    return;
  }

  try {
    await storage.bucket(storageBucket).file(storagePath).delete({ ignoreNotFound: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message.includes("The specified bucket does not exist") ||
      message.includes("No such bucket") ||
      message.includes("Not Found")
    ) {
      return;
    }

    throw error;
  }
}

exports.cleanupInviteOnDelete = onDocumentDeleted(
  `${INVITE_COLLECTION}/{inviteId}`,
  async (event) => {
    const inviteId = normalizeString(event.params.inviteId);
    const invite = event.data?.data?.() ?? {};
    const phoneNumber = normalizeString(invite.phoneNumber).replace(/\D/g, "");
    const profilePhoto = invite.profilePhoto ?? null;

    const queries = [
      db.collection(INQUIRY_COLLECTION).where("inviteId", "==", inviteId),
      db.collection(LEGACY_INQUIRY_COLLECTION).where("inviteId", "==", inviteId),
    ];
    if (phoneNumber) {
      queries.push(db.collection(INQUIRY_COLLECTION).where("phoneNumber", "==", phoneNumber));
      queries.push(db.collection(LEGACY_INQUIRY_COLLECTION).where("phoneNumber", "==", phoneNumber));
    }

    for (const query of queries) {
      await deleteMatchingDocs(query);
    }

    await deleteProfilePhoto(profilePhoto);
  },
);
