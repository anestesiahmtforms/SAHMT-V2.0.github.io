import {FIREBASE_PROJECTS, normalizeFirebaseWebConfig} from './firebase-projects.js';

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
export const indicatorsFirebaseConfig = normalizeFirebaseWebConfig({
  apiKey: env.VITE_INDICATORS_FIREBASE_API_KEY || 'AIzaSyA_NMnXXdGgd6aM0AHHWut0uifw5hXKYrw',
  authDomain: env.VITE_INDICATORS_FIREBASE_AUTH_DOMAIN || FIREBASE_PROJECTS.FC.projectId + '.firebaseapp.com',
  projectId: env.VITE_INDICATORS_FIREBASE_PROJECT_ID || FIREBASE_PROJECTS.FC.projectId,
  storageBucket: env.VITE_INDICATORS_FIREBASE_STORAGE_BUCKET || FIREBASE_PROJECTS.FC.projectId + '.firebasestorage.app',
  messagingSenderId: env.VITE_INDICATORS_FIREBASE_MESSAGING_SENDER_ID || '37778688850',
  appId: env.VITE_INDICATORS_FIREBASE_APP_ID || '1:37778688850:web:314e7dd16e6fd8b332088b'
}, 'FC');

export const indicatorsFirebaseEnabled = env.VITE_INDICATORS_FIREBASE_ENABLED === 'true';
