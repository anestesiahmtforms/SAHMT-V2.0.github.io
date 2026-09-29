import {getApps, initializeApp} from 'firebase/app';
import {firebaseConfig} from './firebase-config.js';

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId === 'sahmt-17a16' && firebaseConfig.appId);
if (firebaseConfig.projectId !== 'sahmt-17a16') {
  throw new Error('A V2 só pode usar o projeto Firebase SAHMT (sahmt-17a16).');
}

export const app = firebaseConfigured
  ? getApps().find((item) => item.name === 'sahmt-v2') ?? initializeApp(firebaseConfig, 'sahmt-v2')
  : null;

const appCheckSiteKey = import.meta.env.VITE_APP_CHECK_SITE_KEY?.trim();
const labelAiEnabled = import.meta.env.VITE_LABEL_AI_ENABLED === 'true';
const useEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
export const appCheckReady = app && labelAiEnabled && appCheckSiteKey && !useEmulators
  ? import('firebase/app-check').then(({initializeAppCheck, ReCaptchaEnterpriseProvider}) => initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true
  }))
  : Promise.resolve(null);
