import {getFirestore, connectFirestoreEmulator} from 'firebase/firestore/lite';
import {app, appCheckReady} from './firebase-app.js';

await appCheckReady;

export const db = app ? getFirestore(app) : null;
if (db && import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  try { connectFirestoreEmulator(db, '127.0.0.1', 8080); }
  catch (error) { if (error.code !== 'failed-precondition') throw error; }
}
