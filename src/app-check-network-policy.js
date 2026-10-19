// Attestation remains mandatory at the server. A missing network must only end
// this attempt, never synthesize an accepted App Check token or block cached UI.
export async function withAppCheckTokenDeadline(action, {online = globalThis.navigator?.onLine !== false, timeoutMs = 5000} = {}) {
  if (!online) throw Object.assign(new Error('Atestado indisponível sem conexão.'), {code: 'app-check/network-unavailable'});
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('O serviço de atestado não respondeu no prazo.'), {code: 'app-check/token-request-timeout'})), timeoutMs);
    })]);
  } finally {clearTimeout(timer);}
}
