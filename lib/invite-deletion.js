import { toInviteRequest } from "./invites";
import { deleteProfilePhoto } from "./storage";

const INVITE_COLLECTION = "invite_requests";
const INQUIRY_COLLECTION = "guest_faq_inquiries";
const DELETE_BATCH_SIZE = 400;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function deleteMatchingDocs(db, query) {
  let deletedCount = 0;

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
    deletedCount += snapshot.size;
  }

  return deletedCount;
}

export async function findInviteRef(db, inviteToken) {
  const safeToken = normalizeString(inviteToken);
  if (!safeToken) {
    return null;
  }

  const directSnapshot = await db.collection(INVITE_COLLECTION).doc(safeToken).get();
  if (directSnapshot.exists) {
    return directSnapshot.ref;
  }

  const phoneNumber = safeToken.replace(/\D/g, "");
  if (!phoneNumber) {
    return null;
  }

  const querySnapshot = await db
    .collection(INVITE_COLLECTION)
    .where("phoneNumber", "==", phoneNumber)
    .limit(1)
    .get();

  if (querySnapshot.empty) {
    return null;
  }

  return querySnapshot.docs[0].ref;
}

export async function deleteInviteAndRelatedInquiries(db, inviteToken) {
  const inviteRef = await findInviteRef(db, inviteToken);
  if (!inviteRef) {
    return null;
  }

  const snapshot = await inviteRef.get();
  if (!snapshot.exists) {
    return null;
  }

  const invite = snapshot.data() ?? {};
  const inviteId = snapshot.id;
  const phoneNumber = normalizeString(invite.phoneNumber).replace(/\D/g, "");
  const profilePhoto = invite.profilePhoto ?? null;

  const inquiryQueries = [
    db.collection(INQUIRY_COLLECTION).where("inviteId", "==", inviteId),
    ...(phoneNumber
      ? [db.collection(INQUIRY_COLLECTION).where("phoneNumber", "==", phoneNumber)]
      : []),
  ];

  let deletedInquiryCount = 0;
  for (const query of inquiryQueries) {
    deletedInquiryCount += await deleteMatchingDocs(db, query);
  }

  await deleteProfilePhoto(profilePhoto);
  await inviteRef.delete();

  return {
    invite: toInviteRequest(inviteId, invite),
    deletedInquiryCount,
  };
}
