const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

export const managementFaFirstLoginConfig = Object.freeze({
  enabled: env.VITE_MANAGEMENT_FA_FIRST_LOGIN_ENABLED === 'true',
  endpoint: env.VITE_MANAGEMENT_FA_FIRST_LOGIN_ENDPOINT?.trim() || '',
  googleClientId: env.VITE_MANAGEMENT_FA_GOOGLE_CLIENT_ID?.trim() || '',
  allowedBrokerOrigin: env.VITE_FIREBASE_PROJECT_AUTH_ALLOWED_ORIGIN?.trim() || ''
});
