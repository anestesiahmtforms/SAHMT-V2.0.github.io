import {getApps, initializeApp} from 'firebase/app';
import {getFirestore} from 'firebase/firestore';
import {normalizeFirebaseWebConfig, resolveFirebaseProjectApp} from './firebase-projects.js';
import {getGoogleProjectAuth} from './google-project-auth-runtime.js';

const projectId = 'sahmt-funcional-fk';
const config = normalizeFirebaseWebConfig({
  apiKey: 'AIzaSyAFlbjIqKzfwEnZgyMOIveNsp4I4Wbf7QM',
  authDomain: 'sahmt-funcional-fk.firebaseapp.com',
  projectId,
  storageBucket: 'sahmt-funcional-fk.firebasestorage.app',
  messagingSenderId: '894041426340',
  appId: '1:894041426340:web:4ff8538196ca1634f2d931'
}, 'FK');

const enabled = import.meta.env?.VITE_FK_FUNCTIONAL_ENABLED === 'true';

export function getFunctionalApp() {
  return resolveFirebaseProjectApp({target: 'FK', enabled, config, getApps, initializeApp,
    invalidConfigMessage: 'A configuração Firebase de FK não corresponde ao projeto Funcional.',
    mismatchMessage: 'A instância Firebase FK não corresponde ao projeto Funcional.'});
}

/** FK reuses the existing, same-UID Google session established by the FA auth coordinator. */
export function getFunctionalAuth() {
  if (!getFunctionalApp()) return null;
  try { return getGoogleProjectAuth('FK'); }
  catch { throw new Error('A autenticação Google independente de FK não pôde ser inicializada.'); }
}

export function getFunctionalFirestore() {
  const app = getFunctionalApp();
  return app ? getFirestore(app) : null;
}

