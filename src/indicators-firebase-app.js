import {getApps, initializeApp} from 'firebase/app';
import {getAuth, initializeAuth, inMemoryPersistence} from 'firebase/auth';
import {getFirestore} from 'firebase/firestore';
import {indicatorsFirebaseConfig, indicatorsFirebaseEnabled} from './indicators-firebase-config.js';
import {resolveFirebaseProjectApp} from './firebase-projects.js';

export function getIndicatorsApp() {
  return resolveFirebaseProjectApp({target: 'FC', enabled: indicatorsFirebaseEnabled,
    config: indicatorsFirebaseConfig, getApps, initializeApp,
    invalidConfigMessage: 'A configuração Firebase de Indicadores está ausente ou não corresponde ao projeto aprovado.',
    mismatchMessage: 'A instância Firebase de Indicadores não corresponde ao projeto aprovado.'});
}

/** Returns only the FC Firestore instance, and only when the FC feature is enabled. */
export function getIndicatorsFirestore() {
  const app = getIndicatorsApp();
  return app ? getFirestore(app) : null;
}

/** FC Auth only. The FC Firestore SDK is deliberately not initialized here. */
export function getIndicatorsAuth() {
  const app = getIndicatorsApp();
  if (!app) return null;
  try { return initializeAuth(app, {persistence: inMemoryPersistence}); }
  catch (error) {
    if (error?.code === 'auth/already-initialized') return getAuth(app);
    throw new Error('A autenticação do Firebase de Indicadores não pôde ser inicializada.');
  }
}
