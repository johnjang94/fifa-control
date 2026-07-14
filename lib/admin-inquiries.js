import { toInquiryItem } from "./inquiry";
import {
  LEGACY_SUPPORT_CHAT_COLLECTION,
  SUPPORT_CHAT_COLLECTION,
} from "./support-chat-inquiries";

export async function listAdminInquiries(db, { limit = 100 } = {}) {
  const [primarySnapshot, legacySnapshot] = await Promise.all([
    db.collection(SUPPORT_CHAT_COLLECTION).orderBy("createdAt", "desc").limit(limit).get(),
    db.collection(LEGACY_SUPPORT_CHAT_COLLECTION).orderBy("createdAt", "desc").limit(limit).get(),
  ]);

  const merged = new Map();
  for (const doc of [...primarySnapshot.docs, ...legacySnapshot.docs]) {
    merged.set(doc.id, doc);
  }

  return [...merged.values()]
    .map((doc) => toInquiryItem(doc.id, doc.data() ?? {}))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}
