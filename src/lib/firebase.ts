// src/lib/firebase.ts
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";

type FirebaseEnv = {
  VITE_FIREBASE_API_KEY: string;
  VITE_FIREBASE_AUTH_DOMAIN: string;
  VITE_FIREBASE_DATABASE_URL: string;
  VITE_FIREBASE_PROJECT_ID: string;
  VITE_FIREBASE_STORAGE_BUCKET: string;
  VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  VITE_FIREBASE_APP_ID: string;
};

const REQUIRED_KEYS: (keyof FirebaseEnv)[] = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_DATABASE_URL",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];

function readEnv(): FirebaseEnv {
  const env = import.meta.env as unknown as Record<string, string | undefined>;

  const out = {} as FirebaseEnv;
  for (const key of REQUIRED_KEYS) {
    const value = env[key];
    if (!value) throw new Error(`Env var ausente: ${key}`);
    out[key] = value;
  }
  return out;
}

const env = readEnv();

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});

export const db = getDatabase(app);
export const auth = getAuth(app);

/**
 * Garante que existe um usuário autenticado (anônimo).
 * Use isto antes de ler/escrever no RTDB quando suas rules dependem de auth.uid.
 */
export async function ensureSignedIn(): Promise<void> {
  if (auth.currentUser) return;
  await signInAnonymously(auth);
}
