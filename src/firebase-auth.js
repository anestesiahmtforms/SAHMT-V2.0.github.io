import {browserLocalPersistence, indexedDBLocalPersistence, initializeAuth, getAuth, connectAuthEmulator, onAuthStateChanged} from 'firebase/auth';
import {app} from './firebase-app.js';
import {registerManagementPilotAuth} from './management-pilot-auth-diagnostics.js';

function initializeSahmtAuth(firebaseApp) {
  if (!firebaseApp) return null;
  try {
    return initializeAuth(firebaseApp, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence]
    });
  } catch (error) {
    // Vite HMR can re-evaluate this module while the named Firebase app survives.
    if (error.code === 'auth/already-initialized') return getAuth(firebaseApp);
    throw error;
  }
}

export const auth = initializeSahmtAuth(app);
if (import.meta.env.VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS === 'true') registerManagementPilotAuth('FA', auth, onAuthStateChanged);
if (auth) {
  auth.languageCode = 'pt-BR';
  if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
    try { connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true}); }
    catch (error) { if (error.code !== 'auth/emulator-config-failed') throw error; }
  }
}
