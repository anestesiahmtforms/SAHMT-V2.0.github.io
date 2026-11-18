import {adminIdentity} from '../communication/domain.js';
import {operationalNoticeIdentity} from './communication-operational-notices.js';
import {assignedInstitutionalGroup, institutionalAssignmentKey} from './institutional-group.js';
import {isSystemOwnerEmail} from './system-account-exclusions.js';

async function readOwnAssignment(key) {
  const [{doc, getDoc}, {db}] = await Promise.all([import('firebase/firestore/lite'), import('./firebase-lite.js')]);
  const snapshot = await getDoc(doc(db, 'userCategories', key));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function isPushCampaignRecipient(user, readAssignment = readOwnAssignment) {
  if (!user?.uid || !user.email || user.emailVerified !== true) return false;
  if (adminIdentity(user) && !operationalNoticeIdentity(user)) return true;
  if (isSystemOwnerEmail(user.email)) return false;
  const assignment = await readAssignment(await institutionalAssignmentKey(user.email));
  return assignedInstitutionalGroup(assignment, user) === 'team';
}

export function activateCommunicationPush(client, browser) {
  const {Notification: systemNotifications, navigator} = browser || {};
  if (!systemNotifications || !navigator?.serviceWorker) {
    return Promise.reject(Object.assign(Error('COMM_PUSH_UNSUPPORTED'), {code: 'COMM_PUSH_UNSUPPORTED'}));
  }
  const permission = systemNotifications.permission;
  return client.enable(permission === 'default' ? systemNotifications.requestPermission() : Promise.resolve(permission));
}

export function pushActivationMessage(error) {
  switch (error?.code) {
    case 'COMM_PUSH_PERMISSION': return 'Permita as notificações do SAHMT nos ajustes do aparelho.';
    case 'COMM_PUSH_UNSUPPORTED': return 'No iPhone, abra o SAHMT pelo ícone da Tela de Início para ativar as notificações.';
    case 'COMM_SESSION_INVALID': return 'Confirme sua conta Google no SAHMT e tente ativar novamente.';
    case 'COMM_DEVICE_LIMIT': return 'O limite de aparelhos com notificações foi atingido.';
    default: return 'Não foi possível registrar este aparelho. Tente novamente.';
  }
}
