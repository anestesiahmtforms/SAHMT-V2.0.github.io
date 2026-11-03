import {app} from './firebase-app.js';
import {deployment} from './deployment-context.js';
import {getFunctions, httpsCallable} from 'firebase/functions';

const invoke = (name, payload) => httpsCallable(getFunctions(app, 'southamerica-east1'), name)(payload);
export async function activateSahmtPush() {
  if (!app || !('serviceWorker' in navigator) || !('Notification' in window)) throw Error('Este dispositivo não suporta notificações Web Push.');
  if (deployment.target !== 'FA') throw Error('Ative notificações pelo aplicativo principal SAHMT.');
  const vapidKey = import.meta.env.VITE_SAHMT_WEB_PUSH_VAPID_KEY;
  if (!vapidKey) throw Error('A chave pública Web Push ainda não foi configurada nesta publicação.');
  const {isSupported, getMessaging, getToken} = await import('firebase/messaging');
  if (!await isSupported()) throw Error('Push não está disponível neste navegador.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw Error('Autorize notificações nas configurações do dispositivo.');
  const reg = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), {vapidKey, serviceWorkerRegistration:reg});
  if (!token) throw Error('Não foi possível obter o token de notificações.');
  await invoke('registerSahmtPushDevice', {token, platform:navigator.userAgent.slice(0,60)});
  return true;
}

export async function sendSahmtPush(notificationId) {
  const result = await invoke('sendSahmtManualNotification', {notificationId});
  return result.data;
}
