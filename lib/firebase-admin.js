import "server-only";

import { cert, getApps, initializeApp } from "firebase-admin/app";

function getFirebaseCredentials() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !rawPrivateKey) {
    throw new Error(
      "Missing Firebase Admin env vars. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.",
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey: rawPrivateKey.replace(/\\n/g, "\n"),
  };
}

export function getFirebaseApp() {
  if (!getApps().length) {
    const credentials = getFirebaseCredentials();
    initializeApp({
      credential: cert(credentials),
      projectId: credentials.projectId,
    });
  }

  return getApps()[0];
}

export function getFirebaseProjectId() {
  return getFirebaseCredentials().projectId;
}
