const ROUTE = '/v1/management/session';
export function validateManagementPilotFirebaseConfig(env) {
  for (const [prefix, projectId] of [['MANAGEMENT', 'sahmt-gestao-5ae66'], ['INDICATORS', 'indicadores---sahmt']]) {
    const field = name => env['VITE_' + prefix + '_FIREBASE_' + name];
    if (field('PROJECT_ID') !== projectId || field('AUTH_DOMAIN') !== projectId + '.firebaseapp.com'
      || typeof field('API_KEY') !== 'string' || !/^AIza[A-Za-z0-9_-]{30,}$/.test(field('API_KEY'))
      || typeof field('APP_ID') !== 'string' || !/^1:[0-9]+:web:[a-f0-9]+$/.test(field('APP_ID')))
      throw Error('PILOT_FIREBASE_CONFIG_INVALID');
  }
  return true;
}
export function managementPilotPwaConfig({endpoint, enabled = false} = {}) {
  if (typeof enabled !== 'boolean') throw Error('PILOT_FLAG_INVALID');
  let url;
  try { url = new URL(endpoint); } catch { throw Error('PILOT_ENDPOINT_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== ROUTE)
    throw Error('PILOT_ENDPOINT_INVALID');
  const on = String(enabled);
  return Object.freeze({
    VITE_MANAGEMENT_FIREBASE_ENABLED: on,
    VITE_INDICATORS_FIREBASE_ENABLED: on,
    VITE_FIREBASE_PROJECT_AUTH_ENABLED: on,
    VITE_FIREBASE_PROJECT_AUTH_AUTO_CONNECT_ENABLED: on,
    VITE_FIREBASE_PROJECT_AUTH_ENDPOINT: url.href,
    VITE_FIREBASE_PROJECT_AUTH_ALLOWED_ORIGIN: url.origin,
    VITE_MANAGEMENT_FA_FIRST_LOGIN_ENABLED: 'false',
    VITE_MANAGEMENT_FA_FIRST_LOGIN_ENDPOINT: '',
    VITE_MANAGEMENT_FA_GOOGLE_CLIENT_ID: '',
    VITE_MANAGEMENT_FIRST_LOGIN_COHORT_ADMIN_ENABLED: 'false',
    VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS: 'true',
    VITE_LABEL_AI_ENABLED: 'false'
  });
}

/** Isolated host root; only generated assets are transformed. */
export function managementPilotManifest(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.icons)) throw Error('PILOT_MANIFEST_INVALID');
  return {...value, id: '/', name: 'SAHMT V2 — Piloto administrativo', short_name: 'SAHMT Piloto',
    start_url: '/', scope: '/', icons: value.icons.map(icon => ({...icon, src: icon.src.replace(/^\/SAHMT-V2\.0\.github\.io\//, '/')}))};
}

export function managementPilotServiceWorker(source) {
  if (typeof source !== 'string' || !source.includes("const BASE = '/SAHMT-V2.0.github.io/';")
    || !/const CACHE = 'sahmt-v2-shell-v\d+';/.test(source)
    || !(source.includes("key.startsWith('sahmt-v2-')") || source.includes('/^sahmt-v2-shell-v\\d+$/')))
    throw Error('PILOT_SERVICE_WORKER_LAYOUT_CHANGED');
  return source.replace("const BASE = '/SAHMT-V2.0.github.io/';", "const BASE = '/';")
    .replaceAll('sahmt-v2-', 'sahmt-auth-pilot-');
}

export function managementPilotAssetsConfig() {
  return {name: 'sahmt-auth-pilot', compatibility_date: '2026-10-10', workers_dev: true,
    assets: {directory: './dist', not_found_handling: 'single-page-application'}};
}
