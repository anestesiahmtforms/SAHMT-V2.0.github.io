import {getApps, initializeApp} from 'firebase/app';
import {getFirestore} from 'firebase/firestore';
import {managementFirebaseConfig, managementFirebaseEnabled} from './management-firebase-config.js';
import {FIREBASE_PROJECTS} from './firebase-projects.js';

export function getManagementApp({enabled = managementFirebaseEnabled} = {}) {
  if (!enabled) return null;
  if (!managementFirebaseConfig.valid) throw new Error('A configuração Firebase de Gestão não está completa ou não corresponde ao projeto aprovado.');
  const existing = getApps().find((item) => item.name === FIREBASE_PROJECTS.FB.appName);
  if (existing) {
    if (existing.options?.projectId !== managementFirebaseConfig.projectId
      || existing.options?.appId !== managementFirebaseConfig.appId
      || existing.options?.authDomain !== managementFirebaseConfig.authDomain) {
      throw new Error('A instância Firebase de Gestão não corresponde ao projeto aprovado.');
    }
    return existing;
  }
  return initializeApp(managementFirebaseConfig, FIREBASE_PROJECTS.FB.appName);
}

/** Returns only the FB Firestore instance, and only when the FB feature is enabled. */
export function getManagementFirestore({enabled = managementFirebaseEnabled} = {}) {
  const app = getManagementApp({enabled});
  return app ? getFirestore(app) : null;
}
