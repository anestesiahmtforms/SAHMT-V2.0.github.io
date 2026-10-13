const WEB_CONFIG_KEYS = Object.freeze(['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId']);

export const FIREBASE_PROJECTS = Object.freeze({
  FA: Object.freeze({projectId: 'sahmt-17a16', appName: 'sahmt-v2', databaseId: '(default)'}),
  FB: Object.freeze({projectId: 'sahmt-gestao-5ae66', appName: 'sahmt-management', databaseId: '(default)'}),
  FC: Object.freeze({projectId: 'indicadores---sahmt', appName: 'sahmt-indicators', databaseId: '(default)'})
});

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function normalizeFirebaseWebConfig(source = {}, target, {appIdPrefix} = {}) {
  const project = FIREBASE_PROJECTS[target];
  if (!project || !plain(source)) throw new Error('FIREBASE_PROJECT_TARGET_INVALID');
  const config = Object.fromEntries(WEB_CONFIG_KEYS.map(key => [key,
    typeof source[key] === 'string' ? source[key].trim() : '']));
  const valid = WEB_CONFIG_KEYS.every(key => config[key].length > 0)
    && config.projectId === project.projectId
    && config.authDomain === project.projectId + '.firebaseapp.com'
    && /^\d+$/.test(config.messagingSenderId)
    && /^1:\d+:web:[a-f\d]+$/i.test(config.appId)
    && (appIdPrefix === undefined || config.appId.startsWith(appIdPrefix))
    && [project.projectId + '.appspot.com', project.projectId + '.firebasestorage.app'].includes(config.storageBucket);
  return Object.freeze({...config, valid});
}

/** Initialize one named project only; callers decide whether a feature is enabled. */
export function resolveFirebaseProjectApp({target, enabled = false, config, getApps, initializeApp,
  invalidConfigMessage = 'FIREBASE_PROJECT_CONFIG_INVALID', mismatchMessage = 'FIREBASE_PROJECT_INSTANCE_MISMATCH'} = {}) {
  const project = FIREBASE_PROJECTS[target];
  if (!project) throw new Error('FIREBASE_PROJECT_TARGET_INVALID');
  if (enabled !== true) return null;
  if (config?.valid !== true || config.projectId !== project.projectId
    || typeof config.appId !== 'string' || !config.appId || typeof config.authDomain !== 'string' || !config.authDomain)
    throw new Error(invalidConfigMessage);
  if (typeof getApps !== 'function' || typeof initializeApp !== 'function') throw new Error('FIREBASE_PROJECT_SDK_INVALID');
  const existing = getApps().find(app => app.name === project.appName);
  if (existing) {
    if (existing.options?.projectId !== config.projectId || existing.options?.appId !== config.appId
      || existing.options?.authDomain !== config.authDomain) throw new Error(mismatchMessage);
    return existing;
  }
  return initializeApp(config, project.appName);
}
