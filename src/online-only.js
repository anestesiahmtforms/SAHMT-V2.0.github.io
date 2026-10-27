import {isOfflineRuntimeForced} from './offline-runtime-mode.js';

export function onlineRequiredError() {
  return Object.assign(new Error('É necessária uma conexão ativa com o servidor. Aguarde o restabelecimento para registrar.'), {code:'online-required'});
}
export function assertOnlineOperation({online=globalThis.navigator?.onLine !== false}={}) {
  if (!online || isOfflineRuntimeForced()) throw onlineRequiredError();
}
export function offlineStorageDisabled() {
  return Object.assign(new Error('O envio posterior e o armazenamento de registros offline foram desativados.'), {code:'offline-storage-disabled'});
}
export function unconfirmedWrite(error, requestId) {
  const code=String(error?.code||'').split('/').pop();
  if(!['unavailable','deadline-exceeded','network-request-failed','unknown','internal'].includes(code))return error;
  return Object.assign(new Error('O servidor não confirmou a resposta. O registro pode ter sido gravado; confira o relatório antes de tentar novamente. Nenhum reenvio foi agendado.'), {code:'write-unconfirmed',requestId,cause:error});
}
