import {isValidDateKey, localDateKey} from './schedule-date.js';

// Read one trusted name projection; this state never authorizes a signature.
export async function watchChecklistResponsibilityDisplay({uid, day}, onNext, onError) {
  if (typeof uid !== 'string' || !uid.trim() || !isValidDateKey(day) || typeof onNext !== 'function') {
    throw new Error('Informe a sessão e a data do Relatório diário.');
  }
  const [{doc, onSnapshot}, {db}] = await Promise.all([import('firebase/firestore'), import('./firebase.js')]);
  if (!db) throw new Error('Sessão indisponível.');
  let stopped = false, expiryTimer = null, lastSnapshot = null;
  const publish = snapshot => {
    if (stopped) return;
    clearTimeout(expiryTimer);
    lastSnapshot = snapshot;
    const data = snapshot.exists() ? snapshot.data() : null;
    const display = data?.display;
    const now = Date.now(), historical = day < localDateKey(new Date(now));
    let name = null, fresh = false, expiresAt = NaN;
    if (display?.schemaVersion === 1 && display.day === day && display.status === 'CONFIRMED' &&
      typeof display.name === 'string' && display.name.trim().length > 0 && display.name.length <= 120 &&
      typeof display.sigla === 'string' && display.sigla.length <= 20 &&
      Number.isInteger(display.position) && display.position >= 1 && display.position <= 30 &&
      /^[a-f0-9]{64}$/.test(display.sourceDigest || '')) {
      let updatedAt = NaN;
      try { updatedAt = display.updatedAt?.toMillis?.() ?? NaN; } catch {}
      expiresAt = typeof display.validUntil === 'string' ? Date.parse(display.validUntil) : NaN;
      const validTimes = Number.isFinite(updatedAt) && Number.isFinite(expiresAt) &&
        updatedAt <= now && expiresAt > updatedAt && expiresAt - updatedAt <= 10 * 60 * 1000;
      if (validTimes) { name = display.name.trim(); fresh = now < expiresAt; }
    } else if (!display && historical && data?.day === day && data.status === 'CONFIRMED' &&
      typeof data.responsible?.name === 'string' && data.responsible.name.trim().length > 0 && data.responsible.name.length <= 120 &&
      /^[a-f0-9]{64}$/.test(data.fingerprint || '') && /^[a-f0-9]{64}$/.test(data.revision || '')) {
      // Existing historical projections come from accepted immutable signatures.
      name = data.responsible.name.trim(); fresh = true;
    }
    const server = snapshot.metadata?.fromCache === false && snapshot.metadata?.hasPendingWrites === false;
    onNext({ready: true, responsible: name ? {name} : null, current: Boolean(name && server && fresh), fromCache: !server});
    if (name && fresh && Number.isFinite(expiresAt)) expiryTimer = setTimeout(() => publish(lastSnapshot), expiresAt - now + 1);
  };
  const unsubscribe = onSnapshot(doc(db, 'checklistResponsibilities', day), {includeMetadataChanges: true}, publish, error => {
    if (stopped) return;
    clearTimeout(expiryTimer);
    onNext({ready: true, responsible: null, current: false, error});
    onError?.(error);
  });
  return () => { stopped = true; clearTimeout(expiryTimer); lastSnapshot = null; unsubscribe(); };
}
