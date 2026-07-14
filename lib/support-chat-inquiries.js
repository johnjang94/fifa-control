export const SUPPORT_CHAT_COLLECTION = "support_chat_inquiries";
export const LEGACY_SUPPORT_CHAT_COLLECTION = "guest_faq_inquiries";

export function getSupportChatCollections() {
  return [SUPPORT_CHAT_COLLECTION, LEGACY_SUPPORT_CHAT_COLLECTION];
}
