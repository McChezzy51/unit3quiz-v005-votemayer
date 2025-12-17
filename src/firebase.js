import { initializeApp, getApps } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

function getEnv(name) {
  const v = import.meta.env[name]
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : ''
}

const firebaseConfig = {
  apiKey: getEnv('VITE_FIREBASE_API_KEY'),
  authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: getEnv('VITE_FIREBASE_PROJECT_ID'),
  appId: getEnv('VITE_FIREBASE_APP_ID'),
  // Optional:
  storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
}

function missingRequiredConfig(cfg) {
  const required = ['apiKey', 'authDomain', 'projectId', 'appId']
  return required.filter((k) => !cfg[k])
}

export const firebaseConfigMissing = missingRequiredConfig(firebaseConfig)

export const firebaseApp =
  firebaseConfigMissing.length > 0
    ? null
    : getApps().length > 0
      ? getApps()[0]
      : initializeApp(firebaseConfig)

export const db = firebaseApp ? getFirestore(firebaseApp) : null
