// Configuração Web pública já usada pelo SAHMT; não contém credencial administrativa.
import {deployment} from './deployment-context.js';
import {firebaseFbConfig} from './firebase-config-fb.js';
const firebaseFaConfig = Object.freeze({
  apiKey: 'AIzaSyDg7plEPhaIieyDP3z462gxG9cY_OQCzvA',
  authDomain: 'sahmt-17a16.firebaseapp.com',
  projectId: 'sahmt-17a16',
  storageBucket: 'sahmt-17a16.firebasestorage.app',
  messagingSenderId: '1072832154794',
  appId: '1:1072832154794:web:38e8e627d4189ebb0a14d3'
});

export const firebaseConfig = deployment.target === 'FB' ? firebaseFbConfig : firebaseFaConfig;
