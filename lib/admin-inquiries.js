import { toInquiryItem } from "./inquiry";
import { SUPPORT_CHAT_COLLECTION } from "./support-chat-inquiries";

export async function listAdminInquiries(db, { limit = 100 } = {}) {
  const snapshot = await db.collection(SUPPORT_CHAT_COLLECTION).orderBy("createdAt", "desc").limit(limit).get();

  return snapshot.docs
    .map((doc) => toInquiryItem(doc.id, doc.data() ?? {}))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}
