import {resolveChecklistResponsibility} from './checklist-responsible.js';
import {isValidDateKey} from './schedule-date.js';

function responsibilityScope({uid, day, isAdmin} = {}) {
  // These queries expose the full contact catalog and all events for the day.
  if (isAdmin !== true) throw new Error('A consulta em tempo real de responsabilidade é exclusiva para administradores.');
  if (typeof uid !== 'string' || !uid.trim() || uid.length > 128 || !isValidDateKey(day)) {
    throw new Error('Informe a sessão e uma data válida para conferir a responsabilidade.');
  }
  return {uid, day};
}

/** Preserves the existing admin reader filters and uses one extra document to detect incomplete sources. */
export function buildChecklistResponsibilityQueries(options, sdk, db) {
  const scope = responsibilityScope(options);
  const {collection, doc, query, where, orderBy, limit} = sdk;
  return {scope, sources: [
    {key: 'schedule', reference: doc(db, 'scheduleDays', scope.day)},
    {key: 'vacations', maximum: 100, reference: query(collection(db, 'vacations'),
      where('active', '==', true), where('start', '<=', scope.day), where('end', '>=', scope.day), orderBy('start', 'asc'), limit(101))},
    // Inactive contacts still disambiguate event member names in the existing resolver.
    {key: 'contacts', maximum: 200, reference: query(collection(db, 'contacts'), orderBy('sigla', 'asc'), limit(201))},
    {key: 'events', maximum: 1000, reference: query(collection(db, 'events'),
      where('active', '==', true), where('date', '==', scope.day), orderBy('date', 'desc'), limit(1001))}
  ]};
}

function recordFrom(document) { return {id: document.id, ...document.data()}; }

/** Display only: this listener does not grant signing permission or replace its server validation. */
export function createChecklistResponsibilityListener(options, onNext, onError, {sdk, db, resolve = resolveChecklistResponsibility} = {}) {
  if (typeof onNext !== 'function') throw new Error('Informe como atualizar a responsabilidade do Checklist.');
  const {scope, sources} = buildChecklistResponsibilityQueries(options, sdk, db);
  const states = new Map(sources.map(({key}) => [key, {ready: false, fromCache: true, pending: false, truncated: false}]));
  const records = new Map(sources.filter(({maximum}) => maximum).map(({key}) => [key, new Map()]));
  const values = {schedule: null, vacations: [], contacts: [], events: []};
  const errors = new Map(), stops = [];
  let stopped = false, dataVersion = 0, computedVersion = -1, responsible = null, resolverError = null;
  const publish = (changedSources = []) => {
    if (stopped) return;
    const metadata = [...states.values()];
    const ready = metadata.every((state) => state.ready);
    const fromCache = metadata.some((state) => state.fromCache);
    const hasPendingWrites = metadata.some((state) => state.pending);
    const truncated = metadata.some((state) => state.truncated);
    if (ready && computedVersion !== dataVersion) {
      computedVersion = dataVersion;
      resolverError = null;
      try {
        responsible = values.schedule ? resolve({...values, day: scope.day}) : null;
      } catch (error) {
        responsible = null; resolverError = error; onError?.(error);
      }
    }
    const error = errors.values().next().value || resolverError || null;
    const confirmed = ready && !fromCache && !hasPendingWrites && !truncated && !error && Boolean(values.schedule && responsible?.name);
    const reason = error?.message || (!ready ? 'Aguardando a conferência das fontes de responsabilidade.'
      : truncated ? 'Não foi possível conferir todas as fontes de responsabilidade.'
      : !values.schedule ? 'Escala não disponível para esta data.' : responsible?.reason || 'Responsável não confirmado.');
    onNext({responsible: responsible ? {...responsible} : null, confirmed, ready, fromCache, hasPendingWrites,
      stale: !confirmed, truncated, changedSources, error, reason});
  };
  const fail = (key, error) => {
    if (stopped) return;
    errors.set(key, error); publish(); onError?.(error);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stops.splice(0).forEach((unsubscribe) => unsubscribe());
    states.clear(); errors.clear(); records.clear();
    values.schedule = null; values.vacations = []; values.contacts = []; values.events = []; responsible = null;
  };
  try {
    for (const {key, reference, maximum} of sources) {
      stops.push(sdk.onSnapshot(reference, {includeMetadataChanges: true}, (snapshot) => {
        if (stopped) return;
        const state = states.get(key);
        let changed = false;
        if (key === 'schedule') {
          const next = snapshot.exists() ? recordFrom(snapshot) : null;
          changed = JSON.stringify(values.schedule) !== JSON.stringify(next);
          if (changed) values.schedule = next;
        } else {
          const byId = records.get(key);
          const changes = state.ready ? snapshot.docChanges({includeMetadataChanges: true}) : null;
          if (changes) {
            for (const change of changes) {
              if (change.type === 'removed') changed = byId.delete(change.doc.id) || changed;
              else {
                const next = recordFrom(change.doc);
                if (JSON.stringify(byId.get(change.doc.id)) !== JSON.stringify(next)) {
                  byId.set(change.doc.id, next); changed = true;
                }
              }
            }
          } else {
            for (const document of snapshot.docs) byId.set(document.id, recordFrom(document));
            changed = snapshot.docs.length > 0;
          }
          const ids = new Set(snapshot.docs.map((document) => document.id));
          for (const id of byId.keys()) if (!ids.has(id)) {byId.delete(id); changed = true;}
          // Keep the real query order while retaining unchanged record objects.
          values[key] = snapshot.docs.slice(0, maximum).map((document) => byId.get(document.id));
        }
        if (changed) dataVersion++;
        states.set(key, {ready: true, fromCache: snapshot.metadata?.fromCache !== false,
          pending: snapshot.metadata?.hasPendingWrites === true || (snapshot.docs || [snapshot]).some((document) => document.metadata?.hasPendingWrites === true),
          truncated: Boolean(maximum && snapshot.docs.length > maximum)});
        errors.delete(key);
        publish(changed ? [key] : []);
      }, (error) => fail(key, error)));
    }
  } catch (error) {
    stop(); throw error;
  }
  return stop;
}

export async function watchChecklistResponsibility(options, onNext, onError) {
  responsibilityScope(options);
  const [sdk, {db}] = await Promise.all([import('firebase/firestore'), import('./firebase.js')]);
  return createChecklistResponsibilityListener(options, onNext, onError, {sdk, db});
}
