import {FIREBASE_PROJECTS} from './firebase-projects.js';
import {isProjectBrokerDiagnosticCode, safeProjectBrokerHttpStatus, sanitizedManagementPilotDiagnostic} from './firebase-project-broker-errors.js';

const CONNECT_STATUSES = new Set(['ready', 'partial', 'blocked', 'unavailable', 'disabled']);
const CONNECT_CODES = new Set(`BROKER_RESPONSE_INVALID BROKER_TARGET_INVALID BROKER_UNAVAILABLE CLOCK_INVALID
CONNECT_TIMEOUT COORDINATOR_DISPOSED FA_CONTEXT_CHANGED FA_SESSION_MISSING FA_TOKEN_INVALID
FIREBASE_PROJECT_TARGETS_INVALID SOURCE_SESSION_CHANGED TARGET_AUTH_UNAVAILABLE TARGET_RECONCILIATION_REQUIRED
TARGET_SESSION_INVALID TARGET_SIGN_IN_FAILED TARGET_SIGN_IN_TIMEOUT TARGET_UID_MISMATCH
OPTIN_DISPOSED OPTIN_UNAVAILABLE BROKER_DEADLINE_EXCEEDED BROKER_CLEANUP_DEADLINE_EXCEEDED
BROKER_OPERATION_FAILED BROKER_PILOT_UID_DENIED BROKER_REQUEST_CANCELLED BROKER_DISABLED
FA_AUTHORIZATION_CHANGED FA_AUTHORIZATION_INCOMPLETE FA_AUTHORIZATION_NOT_FRESH FA_AUTHORIZATION_READ_FAILED
FA_AUTH_USER_INVALID FA_AUTH_IDENTITY_MARKER_CHANGED FA_IDENTITY_OUTSIDE_OPERATIONAL_SCOPE
FA_MANAGEMENT_DENIED FA_PROFILE_REVOKED_OR_MISSING FA_SESSION_CHANGED FA_SESSION_REVOKED FA_TOKEN_REJECTED
FB_ACCESS_DENIED FB_AUTH_UNAVAILABLE FB_ACCOUNT_BINDING_REQUIRED FB_AUTH_USER_CHANGED FB_AUTH_USER_INVALID
FB_AUTH_USER_MISSING FB_AUTH_USER_NOT_FRESH FB_AUTH_USER_READ_FAILED FB_AUTHORIZATION_REVOKED FB_GOOGLE_IDENTITY_MISMATCH
FB_LEASE_CAS_CONFLICT FB_LEASE_CLEANUP_FAILED FB_LEASE_CLEANUP_UNCONFIRMED FB_LEASE_COMMIT_CHANGED
FB_LEASE_CURRENT_INVALID FB_LEASE_EXPIRED FB_LEASE_NOT_FRESH FB_LEASE_READ_FAILED FB_LEASE_VERSION_EXHAUSTED
FB_LEASE_WRITE_FAILED FB_LEASE_WRITE_UNCONFIRMED FB_TOKEN_CLAIMS_TOO_LARGE FB_TOKEN_SIGN_FAILED FB_TOKEN_SIGN_INVALID
FC_ACCESS_DENIED FC_AUTH_USER_CHANGED FC_AUTH_USER_INVALID FC_AUTH_USER_MISSING FC_AUTH_USER_NOT_FRESH
FC_AUTH_USER_READ_FAILED FC_GOOGLE_IDENTITY_MISMATCH FC_TOKEN_SIGN_FAILED FC_TOKEN_SIGN_INVALID
TARGET_DISABLED TARGET_UNAVAILABLE GATEWAY_OPERATION_FAILED GATEWAY_OPERATION_TIMEOUT GATEWAY_DISABLED`
  .split(/\s+/));
const safeConnectCode = code => code == null ? null : CONNECT_CODES.has(code) || isProjectBrokerDiagnosticCode(code) ? code : 'PILOT_CONNECT_ERROR_UNKNOWN';
const FIRESTORE_READ_TARGETS = Object.freeze({
  FB: Object.freeze({projectId: FIREBASE_PROJECTS.FB.projectId, collection: 'trainings'}),
  FC: Object.freeze({projectId: FIREBASE_PROJECTS.FC.projectId, collection: 'indicators'})
});
const safeFirestoreError = error => error?.code === 'permission-denied' ? 'FIRESTORE_PERMISSION_DENIED'
  : error?.code === 'unavailable' ? 'FIRESTORE_UNAVAILABLE'
  : error?.code === 'deadline-exceeded' ? 'FIRESTORE_DEADLINE_EXCEEDED'
  : 'FIRESTORE_READ_FAILED';
async function readOneFirestoreDocument(alias, auth, expectedProjectId, collectionName) {
  const [{collection, query, limit, getDocsFromServer}, projectModule] = await Promise.all([
    import('firebase/firestore'),
    import(alias === 'FB' ? './management-firebase-app.js' : './indicators-firebase-app.js')
  ]);
  const db = alias === 'FB' ? projectModule.getManagementFirestore() : projectModule.getIndicatorsFirestore();
  if (!db) throw Object.assign(new Error(), {code: 'firestore-disabled'});
  if (db.app !== auth.app || db.app?.options?.projectId !== expectedProjectId) throw Object.assign(new Error(), {code: 'project-mismatch'});
  const result = await getDocsFromServer(query(collection(db, collectionName), limit(1)));
  return {projectId: db.app.options.projectId, documentCount: result.size};
}

/** Observes Auth instances supplied by their owners; never creates apps, signs in or reads tokens. */
export function createManagementPilotAuthDiagnostics({enabled = false, now = Date.now,
  firestoreRead = readOneFirestoreDocument} = {}) {
  const records = new Map(), listeners = new Set();
  let disposed = false, lastConnect = null, pendingConnect = null, lastFirestoreRead = null, pendingFirestoreRead = null;
  const snapshot = () => {
    const fa = records.get('FA');
    const faUid = fa?.status === 'connected' ? fa.user?.uid : null;
    const projects = Object.fromEntries(['FA', 'FB', 'FC'].map(alias => {
      const record = records.get(alias);
      const status = record?.status || 'not_initialized';
      return [alias, Object.freeze({status, ...(alias === 'FA'
        ? {googleProviderLinked: status === 'connected' ? record.user.googleProviderLinked : false}
        : {uidMatchesFa: faUid && status === 'connected' ? record.user.uid === faUid : null})})];
    }));
    return Object.freeze({schemaVersion: 1, code: enabled ? 'PILOT_AUTH_OBSERVATION' : 'PILOT_DIAGNOSTICS_DISABLED',
      observedAt: new Date(now()).toISOString(), projects: Object.freeze(projects), lastConnect, firestoreRead: lastFirestoreRead});
  };
  const notify = () => {
    for (const callback of listeners) { try { callback(snapshot()); } catch { /* Diagnostic listeners cannot break authentication. */ } }
  };
  const register = (alias, auth, observeAuthState) => {
    if (!enabled || disposed) return false;
    try {
      const project = FIREBASE_PROJECTS[alias];
      if (!project || !auth || auth.app?.name !== project.appName || auth.app?.options?.projectId !== project.projectId
        || typeof observeAuthState !== 'function') return false;
      if (records.get(alias)?.auth === auth) return true;
      try { records.get(alias)?.unsubscribe?.(); } catch {}
      const record = {auth, user: null, status: 'checking', unsubscribe: null};
      records.set(alias, record);
      record.unsubscribe = observeAuthState(auth, user => {
        if (disposed || records.get(alias) !== record) return;
        if (alias === 'FA' && (record.user?.uid || null) !== (user?.uid || null)) {
          lastConnect = null; pendingConnect = null; lastFirestoreRead = null; pendingFirestoreRead = null;
        }
        // Keep only the comparison input and an already sanitized provider flag.
        // Never retain the Firebase User object, which also owns token state.
        record.user = user && typeof user.uid === 'string' && user.uid
          ? {uid: user.uid, googleProviderLinked: alias === 'FA' && Array.isArray(user.providerData)
            && user.providerData.some(provider => provider?.providerId === 'google.com')} : null;
        record.status = record.user ? 'connected' : 'disconnected';
        notify();
      }, () => {
        if (disposed || records.get(alias) !== record) return;
        record.user = null; record.status = 'unavailable'; notify();
      });
      notify();
      return true;
    } catch {
      const record = records.get(alias);
      if (record) { record.user = null; record.status = 'unavailable'; notify(); }
      return false;
    }
  };
  return Object.freeze({register, snapshot,
    async probeFirestoreReads() {
      if (!enabled || disposed) return Object.freeze({status: 'disabled', code: 'PILOT_DIAGNOSTICS_DISABLED'});
      if (pendingFirestoreRead) return pendingFirestoreRead;
      const fa = records.get('FA'), faUid = fa?.status === 'connected' ? fa.user?.uid : null;
      const attempt = (async () => {
        const projects = {};
        for (const alias of ['FB', 'FC']) {
          const target = FIRESTORE_READ_TARGETS[alias], record = records.get(alias);
          const current = () => !disposed && records.get('FA')?.status === 'connected'
            && records.get('FA')?.user?.uid === faUid && record && records.get(alias) === record
            && record.status === 'connected' && record.auth?.currentUser?.uid === faUid && record.user?.uid === faUid;
          if (!faUid || !record || record.status !== 'connected' || !record.auth?.currentUser) {
            projects[alias] = Object.freeze({projectId: target.projectId, collection: target.collection,
              status: 'not_connected', maxDocuments: 1, documentsReturned: null});
            continue;
          }
          if (!current()) {
            projects[alias] = Object.freeze({projectId: target.projectId, collection: target.collection,
              status: 'uid_mismatch', maxDocuments: 1, documentsReturned: null});
            continue;
          }
          try {
            const result = await firestoreRead(alias, record.auth, target.projectId, target.collection);
            if (!result || result.projectId !== target.projectId || !Number.isInteger(result.documentCount)
              || result.documentCount < 0 || result.documentCount > 1 || !current())
              throw Object.assign(new Error(), {code: 'project-mismatch'});
            projects[alias] = Object.freeze({projectId: target.projectId, collection: target.collection,
              status: 'read_ok', maxDocuments: 1, documentsReturned: result.documentCount});
          } catch (error) {
            projects[alias] = Object.freeze({projectId: target.projectId, collection: target.collection,
              status: error?.code === 'project-mismatch' ? 'project_mismatch' : safeFirestoreError(error),
              maxDocuments: 1, documentsReturned: null});
          }
        }
        const statuses = Object.values(projects).map(item => item.status);
        return Object.freeze({schemaVersion: 1, code: 'PILOT_FIRESTORE_READ_OBSERVATION',
          observedAt: new Date(now()).toISOString(), status: statuses.every(status => status === 'read_ok') ? 'read_ok'
            : statuses.some(status => status === 'read_ok') ? 'partial' : 'unavailable', projects: Object.freeze(projects)});
      })();
      pendingFirestoreRead = attempt;
      lastFirestoreRead = Object.freeze({status: 'checking'}); notify();
      try { lastFirestoreRead = await attempt; return lastFirestoreRead; }
      finally { pendingFirestoreRead = null; notify(); }
    },
    beginConnect() {
      if (!enabled || disposed) return null;
      pendingConnect = Object.freeze({});
      lastConnect = Object.freeze({status: 'connecting', code: null, targets: Object.freeze({})});
      notify(); return pendingConnect;
    },
    finishConnect(attempt, result) {
      if (!enabled || disposed || !attempt || attempt !== pendingConnect) return false;
      pendingConnect = null;
      try {
        const targets = {};
        for (const alias of ['FB', 'FC']) {
          const target = result?.targets?.[alias];
          const diagnostic=target?.status!=='ready' && isProjectBrokerDiagnosticCode(target?.code)
            ?sanitizedManagementPilotDiagnostic(target?.diagnostic):null;
          if (target) targets[alias] = Object.freeze({status: target.status === 'ready' ? 'ready' : 'unavailable',
            code: safeConnectCode(target.code),...(diagnostic?{diagnostic}:{})});
        }
        const diagnostic=isProjectBrokerDiagnosticCode(result?.code)?sanitizedManagementPilotDiagnostic(result?.diagnostic):null;
        lastConnect = Object.freeze({status: CONNECT_STATUSES.has(result?.status) ? result.status : 'unavailable',
          code: safeConnectCode(result?.code),
          ...(diagnostic?{diagnostic}:{}),
          ...(result?.httpStatus === undefined ? {} : {httpStatus: isProjectBrokerDiagnosticCode(result?.code)
            ? safeProjectBrokerHttpStatus(result.httpStatus) : null}), targets: Object.freeze(targets)});
      } catch {
        lastConnect = Object.freeze({status: 'unavailable', code: 'PILOT_CONNECT_ERROR_UNKNOWN', targets: Object.freeze({})});
      }
      notify(); return true;
    },
    subscribe(callback) {
      if (!enabled || disposed || typeof callback !== 'function') return () => {};
      listeners.add(callback); try { callback(snapshot()); } catch {}
      return () => listeners.delete(callback);
    },
    dispose() { disposed = true; for (const record of records.values()) { try { record.unsubscribe?.(); } catch {} }
      records.clear(); listeners.clear(); lastConnect = null; pendingConnect = null; lastFirestoreRead = null; pendingFirestoreRead = null; }
  });
}

const runtime = createManagementPilotAuthDiagnostics({enabled: import.meta.env?.VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS === 'true'});
export const registerManagementPilotAuth = (alias, auth, observeAuthState) => {
  try { return runtime.register(alias, auth, observeAuthState); } catch { return false; }
};
export const beginManagementPilotConnect = () => runtime.beginConnect();
export const finishManagementPilotConnect = (attempt, result) => runtime.finishConnect(attempt, result);

/** Separate DOM panel consumes sanitized snapshots only. No user identifiers are rendered or copied. */
export function mountManagementPilotAuthDiagnostics({document = globalThis.document, clipboard = globalThis.navigator?.clipboard,
  signOut = async () => (await import('./auth.js')).signOutGlobal()} = {}) {
  if (import.meta.env?.VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS !== 'true' || !document?.body) return () => {};
  if (document.getElementById('management-pilot-auth-diagnostics')) return () => {};
  const panel = document.createElement('details');
  panel.id = 'management-pilot-auth-diagnostics';
  panel.setAttribute('aria-label', 'Diagnóstico do piloto de autenticação');
  panel.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:10000;max-width:min(94vw,380px);max-height:50vh;overflow:auto;padding:8px 12px;background:#fff;color:#15324d;border:1px solid #789;border-radius:8px;font:12px system-ui;box-shadow:0 2px 8px #0003';
  const summary = document.createElement('summary');
  const description = document.createElement('p');
  description.textContent = 'Observação das sessões. Google indica provedor vinculado. Acesso a dados depende das regras de cada projeto.';
  const status = document.createElement('pre');
  status.setAttribute('data-management-pilot-status', '');
  status.style.cssText = 'white-space:pre-wrap;font:11px monospace';
  const copy = document.createElement('button');
  copy.type = 'button'; copy.textContent = 'Copiar relatório';
  const firestoreProbe = document.createElement('button');
  firestoreProbe.type = 'button'; firestoreProbe.textContent = 'Testar leitura Firestore (FB e FC)';
  const logout = document.createElement('button');
  logout.type = 'button'; logout.textContent = 'Sair do piloto (FA, FB e FC)';
  const actionStatus = document.createElement('span');
  actionStatus.setAttribute('role', 'status'); actionStatus.setAttribute('aria-live', 'polite');
  panel.append(summary, description, status, firestoreProbe, copy, logout, actionStatus); document.body.append(panel);
  const labels = {connected: 'conectado', disconnected: 'desconectado', not_initialized: 'não iniciado', checking: 'verificando', unavailable: 'indisponível'};
  const unsubscribe = runtime.subscribe(report => {
    summary.textContent = 'Piloto · ' + ['FA', 'FB', 'FC'].map(name => name + ': ' + labels[report.projects[name].status]).join(' · ');
    status.textContent = JSON.stringify(report, null, 2);
  });
  const onCopy = async () => {
    try { await clipboard.writeText(JSON.stringify(runtime.snapshot(), null, 2)); copy.textContent = 'Relatório copiado'; }
    catch { copy.textContent = 'Cópia indisponível'; }
  };
  const onFirestoreProbe = async () => {
    firestoreProbe.disabled = true; actionStatus.textContent = 'Fazendo até uma leitura por projeto…';
    try {
      const result = await runtime.probeFirestoreReads();
      actionStatus.textContent = result.code || result.projects ? 'Leitura verificada. Copie o relatório para conferir o resultado.'
        : 'Diagnóstico indisponível.';
    } catch { actionStatus.textContent = 'Diagnóstico indisponível. Nenhum detalhe sensível foi exibido.'; }
    finally { firestoreProbe.disabled = false; }
  };
  const onLogout = async () => {
    logout.disabled = true; actionStatus.textContent = 'Encerrando as sessões…';
    try {
      const complete = await signOut();
      actionStatus.textContent = complete === true ? 'Logout solicitado. Aguarde FA, FB e FC ficarem desconectados.'
        : 'Logout parcial ou cancelado. Confira o estado das sessões.';
    } catch { actionStatus.textContent = 'Não foi possível concluir o logout. Confira o estado das sessões.'; }
    finally { logout.disabled = false; }
  };
  copy.addEventListener('click', onCopy);
  firestoreProbe.addEventListener('click', onFirestoreProbe);
  logout.addEventListener('click', onLogout);
  return () => { unsubscribe(); copy.removeEventListener('click', onCopy); firestoreProbe.removeEventListener('click', onFirestoreProbe); logout.removeEventListener('click', onLogout); panel.remove(); };
}
