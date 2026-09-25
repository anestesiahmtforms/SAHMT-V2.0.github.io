import {getFunctions, httpsCallable, connectFunctionsEmulator} from 'firebase/functions';
import {app} from './firebase-app.js';

const REGION = 'southamerica-east1';

async function callChecklistSignature(data) {
  if (!app) throw new Error('O Firebase ainda não está configurado neste ambiente.');
  const functions = getFunctions(app, REGION);
  if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
    try { connectFunctionsEmulator(functions, '127.0.0.1', 5001); }
    catch (error) { if (error.code !== 'functions/emulator-config-failed') throw error; }
  }
  const callable = httpsCallable(functions, 'checklistSignature');
  const result = await callable(data);
  return result.data;
}

export function getChecklistSignaturePreview(day) {
  return callChecklistSignature({day, mode: 'preview'});
}

export function signChecklistReport({day, revision, declaration, justification}) {
  return callChecklistSignature({day, mode: 'sign', revision, declaration, justification});
}
