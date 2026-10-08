import {getApps, initializeApp} from 'firebase/app';
import {managementFirebaseConfig, managementFirebaseEnabled} from './management-firebase-config.js';

export function getManagementApp({enabled = managementFirebaseEnabled} = {}) {
  if (!enabled) return null;
  if (!managementFirebaseConfig.valid) throw new Error('A configuração Firebase de Gestão não está completa ou não corresponde ao projeto aprovado.');
  return getApps().find((item) => item.name === 'sahmt-management')
    ?? initializeApp(managementFirebaseConfig, 'sahmt-management');
}
