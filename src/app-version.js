// Increase once per published app update: V2.1, V2.2, V2.3, ...
// Keep the label in the compiled code; a remote value cannot identify loaded code.
export const APP_VERSION = 'V2.1';
export function deviceVersionLabel(device) {
  return /^V\d{1,3}\.\d{1,6}$/.test(device?.appVersion || '') ? device.appVersion : 'Versão não informada';
}
