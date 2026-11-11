import {getApps, initializeApp} from 'firebase/app';
import {getAuth, initializeAuth, inMemoryPersistence, signInWithCustomToken, signOut} from 'firebase/auth';
import {getFirestore} from 'firebase/firestore';
import {normalizeFirebaseWebConfig, resolveFirebaseProjectApp} from './firebase-projects.js';

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
let authInstance = null;

export function getFunctionalApp() {
  return resolveFirebaseProjectApp({target: 'FK', enabled, config, getApps, initializeApp,
    invalidConfigMessage: 'A configuração Firebase de FK não corresponde ao projeto Funcional.',
    mismatchMessage: 'A instância Firebase FK não corresponde ao projeto Funcional.'});
}

/** FK sessions are created only from FA-authorized custom tokens, never a second Google login. */
export function getFunctionalAuth() {
  const app = getFunctionalApp();
  if (!app) return null;
  if (authInstance) return authInstance;
  try { authInstance = initializeAuth(app, {persistence: inMemoryPersistence}); }
  catch (error) {
    if (error?.code === 'auth/already-initialized') authInstance = getAuth(app);
    else throw new Error('A autenticação independente de FK não pôde ser inicializada.');
  }
  return authInstance;
}

export function getFunctionalFirestore() {
  const app = getFunctionalApp();
  return app ? getFirestore(app) : null;
}

export async function signIntoFunctionalProject(customToken, expectedUid) {
  const auth = getFunctionalAuth();
  if (!auth || typeof customToken !== 'string' || !customToken || typeof expectedUid !== 'string' || !expectedUid)
    throw new Error('FK_AUTH_BRIDGE_UNAVAILABLE');
  const credential = await signInWithCustomToken(auth, customToken);
  if (credential.user.uid !== expectedUid || auth.currentUser !== credential.user) {
    try { if (auth.currentUser === credential.user) await signOut(auth); } catch { /* Never retain a mismatched target identity. */ }
    throw new Error('FK_AUTH_UID_MISMATCH');
  }
  return credential.user;
}

export async function signOutFunctionalProject(expectedUid) {
  const auth = getFunctionalAuth();
  if (auth?.currentUser && (expectedUid === undefined || auth.currentUser.uid === expectedUid)) await signOut(auth);
}

