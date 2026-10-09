import {resolveChecklistRotation} from './checklist-rotation.js';
import {isValidDateKey} from './schedule-date.js';

function rotationScope({uid, day} = {}) {
  if (typeof uid !== 'string' || !uid.trim() || uid.length > 128 || !isValidDateKey(day)) {
    throw new Error('Informe a sessão e uma data válida para conferir o rodízio da escala.');
  }
  return {uid, day};
}

/** Two primary sources; the selected name is read from one minimal directory document. */
export function buildChecklistRotationQueries(options, sdk, db) {
  const scope = rotationScope(options);
  const {collection, doc, query, where, orderBy, limit} = sdk;
  return {scope, sources: [
    {key: 'schedule', reference: doc(db, 'scheduleDays', scope.day)},
    {key: 'vacations', maximum: 100, reference: query(collection(db, 'vacations'),
      where('active', '==', true), where('start', '<=', scope.day), where('end', '>=', scope.day), orderBy('start', 'asc'), limit(101))}
  ]};
}

function sourceRecord(document, key) {
  const data = document.data();
  if (key === 'schedule') return {id: document.id, date: data.date, positions: data.positions,
    weekdayLabel: data.weekdayLabel, vacationLabel: data.vacationLabel, highlights: data.highlights};
  if (key === 'vacations') return {id: document.id, active: data.active, start: data.start, end: data.end, siglas: data.siglas, label: data.label};
  return {id: document.id, sigla: data.sigla, name: data.name, active: data.active};
}

function metadata(snapshot, maximum) {
  return {ready: true, fromCache: snapshot.metadata?.fromCache !== false,
    pending: snapshot.metadata?.hasPendingWrites === true || (snapshot.docs || [snapshot]).some(document => document.metadata?.hasPendingWrites === true),
    truncated: Boolean(maximum && snapshot.docs.length > maximum)};
}

/** Informative only: no state from this listener authorizes signatures or writes. */
export function createChecklistRotationListener(options, onNext, onError, {sdk, db, resolve = resolveChecklistRotation} = {}) {
  if (typeof onNext !== 'function') throw new Error('Informe como atualizar o rodízio da escala.');
  const {scope, sources} = buildChecklistRotationQueries(options, sdk, db);
  const states = new Map(sources.map(({key}) => [key, {ready: false, fromCache: true, pending: false, truncated: false}]));
  const vacationsById = new Map(), errors = new Map(), stops = [];
  const values = {schedule: null, vacations: []};
  let stopped = false, dataVersion = 0, computedVersion = -1, selection = null, resolverError = null;
  let nameKey = null, nameSequence = 0, nameStop = null, directory = [];
  let nameState = {ready: false, fromCache: true, pending: false, truncated: false};
  const clearName = () => {
    nameSequence++;
    const previousStop = nameStop; nameStop = null; nameKey = null; directory = [];
    nameState = {ready: false, fromCache: true, pending: false, truncated: false};
    errors.delete('name');
    try { previousStop?.(); } catch {}
  };
  const fail = (key, error) => {
    if (stopped) return;
    errors.set(key, error);
    if (key !== 'name') clearName();
    else directory = [];
    publish();
    onError?.(error);
  };
  const bindName = sigla => {
    clearName();
    if (!sigla || stopped) return;
    nameKey = sigla;
    const ownSequence = nameSequence;
    const current = () => !stopped && ownSequence === nameSequence && nameKey === sigla;
    try {
      const unsubscribe = sdk.onSnapshot(sdk.doc(db, 'eventMembers', sigla), {includeMetadataChanges: true}, snapshot => {
        if (!current()) return;
        const next = snapshot.exists() ? [sourceRecord(snapshot, 'name')] : [];
        const changed = JSON.stringify(directory) !== JSON.stringify(next);
        if (changed) directory = next;
        nameState = metadata(snapshot);
        errors.delete('name');
        publish(changed ? ['name'] : []);
      }, error => { if (current()) fail('name', error); });
      if (current()) nameStop = unsubscribe;
      else unsubscribe?.();
    } catch (error) { if (current()) fail('name', error); }
  };
  const publish = (changedSources = []) => {
    if (stopped) return;
    const primaryStates = [...states.values()];
    const primaryReady = primaryStates.every(state => state.ready);
    const truncated = primaryStates.some(state => state.truncated);
    const primaryError = sources.map(({key}) => errors.get(key)).find(Boolean);
    if (primaryReady && computedVersion !== dataVersion) {
      computedVersion = dataVersion; resolverError = null;
      try { selection = resolve({...values, day: scope.day}); }
      catch (error) { selection = null; resolverError = error; onError?.(error); }
    }
    const selectedSigla = primaryReady && !primaryError && !truncated && !resolverError && selection?.complete === true ? selection.sigla : null;
    if (selectedSigla !== nameKey) bindName(selectedSigla);
    let result = selection;
    if (selectedSigla && nameState.ready && !errors.has('name')) {
      try { result = resolve({...values, day: scope.day, directory}); }
      catch (error) { result = null; resolverError = error; onError?.(error); }
    }
    const error = primaryError || errors.get('name') || resolverError || null;
    const ready = primaryReady && (!selectedSigla || nameState.ready);
    const allStates = selectedSigla ? [...primaryStates, nameState] : primaryStates;
    const fromCache = allStates.some(state => state.fromCache);
    const hasPendingWrites = allStates.some(state => state.pending);
    const rotation = ready && !error && !truncated && result?.complete === true && result.name
      ? {name: result.name, sigla: result.sigla, position: result.position} : null;
    const current = Boolean(rotation && !fromCache && !hasPendingWrites);
    const reason = error?.message || (!primaryReady ? 'Aguardando a escala e as férias.'
      : truncated ? 'Aguardando a conferência completa das férias.'
      : selectedSigla && !nameState.ready ? 'Aguardando o nome da escala.'
      : result?.reason || 'Rodízio da escala indisponível.');
    onNext({rotation, ready, current, stale: !current, fromCache, hasPendingWrites, truncated, changedSources, error, reason});
  };
  const stop = () => {
    if (stopped) return;
    stopped = true; clearName();
    for (const unsubscribe of stops.splice(0)) { try { unsubscribe(); } catch {} }
    states.clear(); errors.clear(); vacationsById.clear();
    values.schedule = null; values.vacations = []; selection = null; resolverError = null;
  };
  try {
    for (const {key, reference, maximum} of sources) {
      stops.push(sdk.onSnapshot(reference, {includeMetadataChanges: true}, snapshot => {
        if (stopped) return;
        const state = states.get(key);
        let changed = false;
        if (key === 'schedule') {
          const next = snapshot.exists() ? sourceRecord(snapshot, key) : null;
          changed = JSON.stringify(values.schedule) !== JSON.stringify(next);
          if (changed) values.schedule = next;
        } else {
          const changes = state.ready ? snapshot.docChanges({includeMetadataChanges: true}) : null;
          if (changes) {
            for (const change of changes) {
              if (change.type === 'removed') changed = vacationsById.delete(change.doc.id) || changed;
              else {
                const next = sourceRecord(change.doc, key);
                if (JSON.stringify(vacationsById.get(change.doc.id)) !== JSON.stringify(next)) {
                  vacationsById.set(change.doc.id, next); changed = true;
                }
              }
            }
          } else {
            for (const document of snapshot.docs) vacationsById.set(document.id, sourceRecord(document, key));
            changed = snapshot.docs.length > 0;
          }
          const ids = new Set(snapshot.docs.map(document => document.id));
          for (const id of vacationsById.keys()) if (!ids.has(id)) { vacationsById.delete(id); changed = true; }
          values[key] = snapshot.docs.slice(0, maximum).map(document => vacationsById.get(document.id));
        }
        if (changed) dataVersion++;
        states.set(key, metadata(snapshot, maximum));
        errors.delete(key);
        publish(changed ? [key] : []);
      }, error => fail(key, error)));
    }
  } catch (error) { stop(); throw error; }
  return stop;
}

export async function watchChecklistRotation(options, onNext, onError) {
  rotationScope(options);
  const [sdk, {db}] = await Promise.all([import('firebase/firestore'), import('./firebase.js')]);
  if (!db) throw new Error('Sessão indisponível.');
  return createChecklistRotationListener(options, onNext, onError, {sdk, db});
}
