import {FIREBASE_PROJECTS, normalizeFirebaseWebConfig} from './firebase-projects.js';

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
export const indicatorsFirebaseConfig = normalizeFirebaseWebConfig({
  apiKey: env.VITE_INDICATORS_FIREBASE_API_KEY,
  authDomain: env.VITE_INDICATORS_FIREBASE_AUTH_DOMAIN || FIREBASE_PROJECTS.FC.projectId + '.firebaseapp.com',
  projectId: env.VITE_INDICATORS_FIREBASE_PROJECT_ID || FIREBASE_PROJECTS.FC.projectId,
  storageBucket: env.VITE_INDICATORS_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_INDICATORS_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_INDICATORS_FIREBASE_APP_ID
}, 'FC');

// Disabled by default; enabling the app instance does not open Firestore Rules or grant access.
export const indicatorsFirebaseEnabled = env.VITE_INDICATORS_FIREBASE_ENABLED === 'true';
