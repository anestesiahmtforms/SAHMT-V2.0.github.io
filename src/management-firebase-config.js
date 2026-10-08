const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];

export function normalizeManagementFirebaseConfig(source = {}) {
  const config = Object.fromEntries(requiredKeys.map((key) => [key, typeof source[key] === 'string' ? source[key].trim() : '']));
  const valid = requiredKeys.every((key) => config[key].length > 0)
    && config.projectId === 'sahmt-gestao-5ae66'
    && config.authDomain === 'sahmt-gestao-5ae66.firebaseapp.com'
    && config.appId.startsWith('1:613953519880:web:');
  return Object.freeze({ ...config, valid });
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
