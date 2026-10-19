export function firebaseFailureCode(error) {
  const code = String(error?.code || '').replace(/^(?:firestore|auth)\//, '').toLowerCase();
  // Some SDK/browser combinations expose a failed fetch as `unknown` while navigator.onLine remains true.
  // A generic unknown error is deliberately not eligible for offline access.
  if ((!code || code === 'unknown') && /failed to fetch|fetch api cannot load|network(?: request)? (?:failed|error)|networkerror|load failed|client is offline|internet.disconnected/i.test(String(error?.message || ''))) return 'unavailable';
  return code;
}
