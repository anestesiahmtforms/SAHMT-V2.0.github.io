import {repairAppFiles} from './app-repair.js';
import {APP_VERSION} from './app-version.js';

export const loadedAppRelease = Number(import.meta.env?.VITE_APP_RELEASE || 0);
function browserStorage(name) {try {return globalThis[name];} catch {return null;}}
export function newAppUpdateId(crypto = globalThis.crypto) {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
export function updateRequest(value, target) {
  return value && /^[a-zA-Z0-9_-]{16,80}$/.test(value.id || '') && value.target === target &&
    Number.isSafeInteger(value.minimumRelease) && value.minimumRelease > 0 ? value : null;
}
export function installationId(storage, crypto = globalThis.crypto, displayMode = 'browser') {
  const key = 'sahmt-app-installation-v1:' + displayMode;
  try {
    const saved = storage.getItem(key);
    if (/^[a-f0-9-]{36}$/.test(saved || '')) return saved;
    const id = newAppUpdateId(crypto); storage.setItem(key, id); return id;
  } catch { return newAppUpdateId(crypto); }
}
export function appDisplayMode(navigator = globalThis.navigator, matchMedia = globalThis.matchMedia) {
  return navigator?.standalone === true || matchMedia?.call(globalThis, '(display-mode: standalone)').matches === true ? 'standalone' : 'browser';
}
export function deviceInstallationLabel(device) {
  return device.displayMode === 'standalone' ? (device.platform === 'iOS' ? 'App da Tela de Início' : 'App instalado') : device.displayMode === 'browser' ? 'Navegador' : 'Modo não informado';
}
export function devicePlatform(navigator = globalThis.navigator) {
  const ua = navigator?.userAgent || '';
  return /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(ua) && navigator?.maxTouchPoints > 1) ? 'iOS' :
    /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : 'Outro';
}
export function recoveryUrl(target, origin = globalThis.location.origin) {
  return origin + '/SAHMT-V2.0.github.io/' + (target === 'FB' ? 'gestao/' : '') + 'tools/refresh-app.html?' +
    new URLSearchParams({target, route: target === 'FB' ? '#/management' : '#/home'});
}
export function deviceUpdateState(device, request) {
  return request && device.confirmedRequestId === request.id && device.loadedRelease >= request.minimumRelease ? 'Confirmado' : 'Pendente';
}
export function devicePublishedState(device, publishedRelease) {
  if(!Number.isSafeInteger(device.loadedRelease)||device.loadedRelease<=0)return 'Versão não confirmada';
  if(!Number.isSafeInteger(publishedRelease)||publishedRelease<=0)return 'Versão registrada';
  return device.loadedRelease>=publishedRelease?'Atualizado':'Há versão mais recente';
}

// The first server-confirmed profile of this document is the startup boundary.
// Later profile changes never interrupt a form already being filled in.
export function createTargetedAppUpdates({target, release = loadedAppRelease, deviceId,
  platform = devicePlatform(), displayMode = appDisplayMode(), record, enforce, storage, now = Date.now, onFailure = () => {}, repair = repairAppFiles}) {
  let uid = '', opened = false, written = '', generation = 0, active = null;
  const retries = new Set();
  const retry = () => {
    if (!active) return false;
    return repair({target, hash: globalThis.location?.hash || (target === 'FB' ? '#/management' : '#/home')});
  };
  return {retry, get blocked() {return Boolean(active);}, setSession(session) {
    const nextUid = session.user?.uid || '';
    if (nextUid !== uid || !['signed-in', 'loading-profile', 'auth-limited'].includes(session.status)) {
      uid = nextUid; opened = false; written = ''; generation++; active = null; enforce(null);
    }
    if (session.status !== 'signed-in' || session.offline || session.validatingProfile || !uid) return;
    const request = updateRequest(session.profile?.appUpdateRequest, target);
    const startup = !opened; opened = true;
    if (active && (!request || active.id !== request.id)) {active = null; enforce(null);}
    if (startup && request && release < request.minimumRelease) {
      active = request;
      // At most one automatic trip per request and browser session; a failed
      // recovery returns to a retry screen, never a reload loop.
      const key = 'sahmt-required-update:' + uid + ':' + deviceId + ':' + request.id;
      let automatic = false;
      try {
        if (!storage) throw Error('APP_UPDATE_STORAGE_UNAVAILABLE');
        const prior = Number(storage.getItem(key));
        if (!retries.has(key) && (!prior || now() - prior > 900000)) {
          storage.setItem(key, String(now())); retries.add(key); automatic = true;
        }
      } catch { /* A manual retry remains available with restricted storage. */ }
      enforce({request, automatic, retry});
    }
    const confirmedRequestId = request && release >= request.minimumRelease ? request.id : '';
    const signature = [uid, release, confirmedRequestId].join(':');
    if (written === signature || !Number.isSafeInteger(release) || release <= 0) return;
    written = signature;
    const owner = uid, token = generation;
    Promise.resolve().then(() => {
      if (token !== generation) return;
      return record({uid: owner, deviceId, target, platform, displayMode, appVersion: APP_VERSION, loadedRelease: release, confirmedRequestId});
    }).catch(error => {if (token === generation) {written = ''; onFailure(error);}});
  }};
}

export function installTargetedAppUpdates({target, release = loadedAppRelease, document = globalThis.document,
  storage = browserStorage('sessionStorage'), localStorage = browserStorage('localStorage'),
  displayMode = appDisplayMode(),
  services = () => import('./app-updates-targeted-firebase.js'), signOut = () => {}, repair = repairAppFiles}) {
  let dialog = null;
  const close = () => {dialog?.close(); dialog?.remove(); dialog = null;};
  return createTargetedAppUpdates({target, release, deviceId: installationId(localStorage, globalThis.crypto, displayMode), displayMode, storage, repair,
    record: async value => (await services()).recordAppInstallation(value),
    enforce(value) {
      close(); if (!value) return;
      dialog = document.createElement('dialog'); dialog.className = 'required-app-update';
      dialog.setAttribute('aria-labelledby', 'required-app-update-title');
      dialog.innerHTML = '<h2 id="required-app-update-title">Atualização necessária</h2><p>O administrador solicitou uma versão mais recente para sua conta. Este aparelho precisa concluir a atualização para continuar.</p><p data-update-state role="status">Sua sessão e seus dados salvos serão preservados.</p><button type="button" class="primary-button" data-required-update>ATUALIZAR ESTE APARELHO</button><button type="button" class="secondary-button" data-update-signout>SAIR DA CONTA</button>';
      const attempt = () => {
        const ok = value.retry();
        if (!ok && dialog) dialog.querySelector('[data-update-state]').textContent = 'Conecte este aparelho à internet e toque em atualizar novamente.';
      };
      dialog.addEventListener('cancel', event => event.preventDefault());
      dialog.querySelector('[data-required-update]').onclick = attempt;
      dialog.querySelector('[data-update-signout]').onclick = () => {void signOut();};
      document.body.append(dialog); dialog.showModal();
      const openedDialog = dialog;
      if (value.automatic) queueMicrotask(() => {if (dialog === openedDialog) attempt();});
    }
  });
}
