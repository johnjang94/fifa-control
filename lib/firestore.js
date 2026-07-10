import "server-only";

import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseApp } from "./firebase-admin";

export function getDb() {
  return getFirestore(getFirebaseApp());
}
