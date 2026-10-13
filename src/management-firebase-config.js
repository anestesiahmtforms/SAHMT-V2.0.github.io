import {normalizeFirebaseWebConfig} from './firebase-projects.js';

export function normalizeManagementFirebaseConfig(source = {}) {
  return normalizeFirebaseWebConfig(source, 'FB', {appIdPrefix: '1:613953519880:web:'});
}

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
export const managementFirebaseConfig = normalizeManagementFirebaseConfig({
  apiKey: env.VITE_MANAGEMENT_FIREBASE_API_KEY,
  authDomain: env.VITE_MANAGEMENT_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_MANAGEMENT_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_MANAGEMENT_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_MANAGEMENT_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_MANAGEMENT_FIREBASE_APP_ID
});

// Deliberately false until backup, Rules, authorization and the migration plan are approved.
export const managementFirebaseEnabled = env.VITE_MANAGEMENT_FIREBASE_ENABLED === 'true';
