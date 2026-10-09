import {getApps, initializeApp} from 'firebase/app';
import {managementFirebaseConfig, managementFirebaseEnabled} from './management-firebase-config.js';

export function getManagementApp({enabled = managementFirebaseEnabled} = {}) {
  if (!enabled) return null;
  if (!managementFirebaseConfig.valid) throw new Error('A configuração Firebase de Gestão não está completa ou não corresponde ao projeto aprovado.');
  const existing = getApps().find((item) => item.name === 'sahmt-management');
  if (existing) {
    if (existing.options?.projectId !== managementFirebaseConfig.projectId
      || existing.options?.appId !== managementFirebaseConfig.appId
      || existing.options?.authDomain !== managementFirebaseConfig.authDomain) {
      throw new Error('A instância Firebase de Gestão não corresponde ao projeto aprovado.');
    }
    return existing;
  }
  return initializeApp(managementFirebaseConfig, 'sahmt-management');
}
