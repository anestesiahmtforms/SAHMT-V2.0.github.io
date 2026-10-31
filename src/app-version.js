import seed from './app-version-seed.json' with {type:'json'};
// Production embeds the publication plan; the seed is for local/PR previews.
// A remote label must never replace the version of the code actually running.
export const APP_VERSION = import.meta.env?.VITE_APP_VERSION || seed.appVersion;
export function deviceVersionLabel(device) {
  return /^V\d{1,3}\.\d{1,6}$/.test(device?.appVersion || '') ? device.appVersion : 'Versão não informada';
}
