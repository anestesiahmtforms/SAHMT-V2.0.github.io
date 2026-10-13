const EXISTING_GOOGLE_LOGIN = 'USE_EXISTING_SIGN_IN_GOOGLE_POPUP';

/** Keeps the existing popup as the default and only fallback for server-confirmed linked users. */
export function createManagementGoogleLogin({enabled = false, firstLogin, popupSignIn} = {}) {
  if (typeof popupSignIn !== 'function') throw new Error('GOOGLE_LOGIN_CONFIG_INVALID');
  if (enabled !== true) return Object.freeze({signIn: popupSignIn});
  if (typeof firstLogin?.signIn !== 'function') throw new Error('FIRST_LOGIN_CONFIG_INVALID');
  return Object.freeze({async signIn() {
    const result = await firstLogin.signIn();
    if (result?.ok === true) return result;
    if (result?.code === EXISTING_GOOGLE_LOGIN) return popupSignIn();
    const error = new Error(typeof result?.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(result.code)
      ? result.code : 'FIRST_LOGIN_FAILED');
    error.code = error.message;
    throw error;
  }});
}
