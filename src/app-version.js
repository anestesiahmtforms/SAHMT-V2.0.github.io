import seed from './app-version-seed.json' with {type:'json'};
// The visible version is approved explicitly. Publication timestamps identify cache provenance.
export const PUBLISHED_APP_VERSION = seed.appVersion;
export const PRE_RECONNECTION_APP_VERSION = seed.legacyAppVersion;
export let APP_VERSION = typeof document==='undefined'?PUBLISHED_APP_VERSION:PRE_RECONNECTION_APP_VERSION;
export function setDeviceAppVersion(version,doc) {
  APP_VERSION=version;
  for(const badge of doc.querySelectorAll('[data-app-version]')){
    badge.textContent=version;
    badge.setAttribute('aria-label','Versão do app '+version);
  }
}
export function deviceVersionLabel(device) {
  return /^V\d{1,3}\.\d{1,6}$/.test(device?.appVersion || '') ? device.appVersion : 'Versão não informada';
}
