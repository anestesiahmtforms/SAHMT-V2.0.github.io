import {connectFunctionsEmulator, getFunctions, httpsCallable} from 'firebase/functions';
import {app} from './firebase-app.js';

const REGION = 'southamerica-east1';

async function callTrainingFunction(name, payload) {
  if (!app) throw new Error('O Firebase ainda não está configurado neste ambiente.');
  const functions = getFunctions(app, REGION);
  if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
    try { connectFunctionsEmulator(functions, '127.0.0.1', 5001); }
    catch (error) { if (error.code !== 'functions/emulator-config-failed') throw error; }
  }
  const result = await httpsCallable(functions, name)(payload);
  return result.data;
}

export function startTraining(trainingId) {
  return callTrainingFunction('trainingStart', {trainingId});
}

export function completeTraining(trainingId, {ended = false} = {}) {
  return callTrainingFunction('completeTraining', {trainingId, ended});
}
