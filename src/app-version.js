import seed from './app-version-seed.json' with {type:'json'};
// The owner froze the visible version at V3.4 until explicitly authorizing
// version counting again. Publication timestamps identify cache provenance.
export const APP_VERSION = seed.appVersion;
export function deviceVersionLabel(device) {
  return /^V\d{1,3}\.\d{1,6}$/.test(device?.appVersion || '') ? device.appVersion : 'Versão não informada';
}
