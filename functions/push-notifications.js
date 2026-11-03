import {createHash} from 'node:crypto';
import {getApps, initializeApp} from 'firebase-admin/app';
import {getFirestore, FieldValue} from 'firebase-admin/firestore';
import {getMessaging} from 'firebase-admin/messaging';
import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {onDocumentCreated} from 'firebase-functions/v2/firestore';

if (!getApps().length) initializeApp();
const db = getFirestore();
const REGION = 'southamerica-east1';
const hashToken = token => createHash('sha256').update(token).digest('hex');
const validToken = token => typeof token === 'string' && token.length >= 50 && token.length <= 4096;
const eligible = profile => profile?.active === true && profile?.access === true;
const isAdmin = profile => eligible(profile) && (profile.role === 'administrador_app' || profile.permissions?.admin === true);
const canRead = profile => eligible(profile) && (isAdmin(profile) || profile.permissions?.notificationsRead === true);
const routeSet = new Set(['home','events','labels','management','checklist','training','notifications']);
const safeRoute = value => routeSet.has(value) ? value : 'notifications';

export const registerSahmtPushDevice = onCall({region: REGION, enforceAppCheck: false}, async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Entre no SAHMT.');
  const profileSnap = await db.doc('users/' + uid).get();
  if (!canRead(profileSnap.data())) throw new HttpsError('permission-denied', 'Sem acesso às notificações.');
  const token = request.data?.token;
  if (!validToken(token)) throw new HttpsError('invalid-argument', 'Token inválido.');
  const ref = db.doc('sahmtPushDevices/' + hashToken(token));
  await ref.set({uid, token, updatedAt: FieldValue.serverTimestamp(), platform: String(request.data?.platform || '').slice(0, 60)});
  return {registered: true};
});

export const unregisterSahmtPushDevice = onCall({region: REGION, enforceAppCheck: false}, async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Entre no SAHMT.');
  const token = request.data?.token;
  if (!validToken(token)) throw new HttpsError('invalid-argument', 'Token inválido.');
  const ref = db.doc('sahmtPushDevices/' + hashToken(token));
  const snap = await ref.get();
  if (snap.exists && snap.data().uid === uid) await ref.delete();
  return {removed: true};
});

async function audienceMatches(notification, uid, profile, groupMembers) {
  if (!canRead(profile)) return false;
  const value = notification.audienceValue || '';
  switch (notification.audienceType) {
    case 'ALL': return true;
    case 'USER': return uid === value;
    case 'ROLE': return profile.role === value;
    case 'SIGLA': return profile.sigla === value;
    case 'GROUP': return groupMembers?.has(uid) === true;
    // Do not guess management-area membership from inconsistent profile fields.
    case 'MANAGEMENT_AREA': return false;
    default: return false;
  }
}

export const sendSahmtManualNotification = onCall({region: REGION, enforceAppCheck: false, timeoutSeconds: 120, memory: '512MiB'}, async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Entre no SAHMT.');
  const actor = (await db.doc('users/' + uid).get()).data();
  if (!isAdmin(actor)) throw new HttpsError('permission-denied', 'Envio exclusivo dos administradores.');
  const id = request.data?.notificationId;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new HttpsError('invalid-argument', 'Comunicado inválido.');
  const ref = db.doc('notifications/' + id);
  // Atomic claim prevents repeated sends by tapping twice or concurrent admin calls.
  const claimed = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const item = snap.data();
    const now = Date.now();
    if (!item || item.createdByUid !== uid || !item.active || item.startAt?.toMillis?.() > now || item.endAt?.toMillis?.() < now) {
      throw new HttpsError('failed-precondition', 'O comunicado precisa estar publicado e vigente por este administrador.');
    }
    if (item.pushStatus) throw new HttpsError('already-exists', 'O envio push já foi solicitado para este comunicado.');
    tx.update(ref, {pushStatus: 'processing', pushRequestedAt: FieldValue.serverTimestamp(), pushRequestedByUid: uid});
    return item;
  });
  if (claimed.audienceType === 'MANAGEMENT_AREA') {
    await ref.update({pushStatus:'unsupported-audience'});
    throw new HttpsError('failed-precondition','Envio push para Área de Gestão ainda não habilitado; o comunicado permanece publicado.');
  }
  let groupMembers = null;
  if (claimed.audienceType === 'GROUP') {
    const snap = await db.doc('notificationGroups/' + claimed.audienceValue).get();
    if (!snap.exists || snap.data().active !== true) {
      await ref.update({pushStatus:'invalid-audience'});
      throw new HttpsError('failed-precondition','Grupo inativo ou inexistente.');
    }
    groupMembers = new Set(snap.data().memberUids || []);
  }
  let cursor = null, delivered = 0, failed = 0, matched = 0;
  try {
    while (true) {
      let query = db.collection('sahmtPushDevices').orderBy('__name__').limit(250);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;
      cursor = page.docs[page.docs.length - 1];
      const profileMap = new Map();
      const tokens = [];
      for (const device of page.docs) {
        const {uid: targetUid, token} = device.data();
        if (!targetUid || !validToken(token)) continue;
        if (!profileMap.has(targetUid)) {
          profileMap.set(targetUid, (await db.doc('users/' + targetUid).get()).data());
        }
        if (await audienceMatches(claimed, targetUid, profileMap.get(targetUid), groupMembers)) tokens.push({token, ref:device.ref});
      }
      matched += tokens.length;
      for (let i = 0; i < tokens.length; i += 500) {
        const batch = tokens.slice(i,i+500);
        const results = await getMessaging().sendEachForMulticast({
          tokens: batch.map(x=>x.token),
          data: {title: String(claimed.title).slice(0,120), body: String(claimed.message).slice(0,300), route:safeRoute(claimed.actionRoute), notificationId:id},
          webpush: {headers:{TTL:'86400'}}
        });
        delivered += results.successCount;
        failed += results.failureCount;
        await Promise.all(results.responses.map((item,j) => {
          const code = item.error?.code || '';
          return /registration-token-not-registered|invalid-registration-token/.test(code) ? batch[j].ref.delete() : Promise.resolve();
        }));
      }
      if (page.size < 250) break;
    }
    await ref.update({pushStatus:'completed',pushDelivered:delivered,pushFailed:failed,pushMatched:matched,pushCompletedAt:FieldValue.serverTimestamp()});
    return {delivered, failed, matched};
  } catch (error) {
    await ref.update({pushStatus:'failed',pushDelivered:delivered,pushFailed:failed,pushMatched:matched}).catch(()=>{});
    throw new HttpsError('internal','O envio não foi concluído. Verifique o status do comunicado antes de reenviar.');
  }
});
