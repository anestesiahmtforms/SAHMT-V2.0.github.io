import {getFirestore, initializeFirestore, memoryLocalCache, connectFirestoreEmulator} from 'firebase/firestore';
import {app, appCheckReady} from './firebase-app.js';

await appCheckReady;

let db = null;
if (app) {
  try {
    db = initializeFirestore(app, {
      localCache: memoryLocalCache()
    });
  } catch (error) {
    if (error.code !== 'failed-precondition' && error.code !== 'already-exists') throw error;
    db = getFirestore(app);
  }
}

if (db && import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  try { connectFirestoreEmulator(db, '127.0.0.1', 8080); }
  catch (error) { if (error.code !== 'failed-precondition') throw error; }
}

export {db};
