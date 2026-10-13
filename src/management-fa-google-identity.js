const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';

/** Loads Google Identity Services only when the opt-in first-login flow runs. */
export function createGoogleIdentityTokenRequester({clientId, documentImpl = globalThis.document,
  googleApi = () => globalThis.google, timeoutMs = 120000} = {}) {
  if (typeof clientId !== 'string' || !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)
    || !documentImpl?.createElement || !documentImpl?.head?.appendChild || typeof googleApi !== 'function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10000 || timeoutMs > 180000)
    throw new Error('GOOGLE_IDENTITY_REQUESTER_CONFIG_INVALID');
  let loading;
  async function load() {
    if (googleApi()?.accounts?.id) return;
    if (!loading) loading = new Promise((resolve, reject) => {
      const script = documentImpl.createElement('script');
      const timer = setTimeout(() => reject(new Error('GOOGLE_IDENTITY_SCRIPT_TIMEOUT')), 15000);
      script.src = GIS_SCRIPT;
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'no-referrer';
      script.onload = () => {
        clearTimeout(timer);
        googleApi()?.accounts?.id ? resolve() : reject(new Error('GOOGLE_IDENTITY_SCRIPT_INVALID'));
      };
      script.onerror = () => { clearTimeout(timer); reject(new Error('GOOGLE_IDENTITY_SCRIPT_UNAVAILABLE')); };
      documentImpl.head.appendChild(script);
    }).catch(error => { loading = null; throw error; });
    return loading;
  }
  return async function requestGoogleIdToken({nonce} = {}) {
    if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{22,128}$/.test(nonce))
      throw new Error('GOOGLE_IDENTITY_NONCE_INVALID');
    await load();
    const api = googleApi()?.accounts?.id;
    if (!api || typeof api.initialize !== 'function' || typeof api.prompt !== 'function')
      throw new Error('GOOGLE_IDENTITY_API_UNAVAILABLE');
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, token) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(token);
      };
      const timer = setTimeout(() => finish(new Error('GOOGLE_IDENTITY_TIMEOUT')), timeoutMs);
      try {
        api.initialize({client_id: clientId, nonce, auto_select: false, cancel_on_tap_outside: true,
          callback: response => {
            const token = response?.credential;
            if (typeof token !== 'string' || token.length < 1 || token.length > 16000)
              finish(new Error('GOOGLE_IDENTITY_RESPONSE_INVALID'));
            else finish(null, token);
          }});
        api.prompt(notification => {
          if (settled) return;
          if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()
            || notification?.isDismissedMoment?.()) finish(new Error('GOOGLE_IDENTITY_CANCELLED'));
        });
      } catch { finish(new Error('GOOGLE_IDENTITY_UNAVAILABLE')); }
    });
  };
}
