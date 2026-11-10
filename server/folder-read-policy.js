/** Source-local control document: runtimePolicy/folders. */
const failure = (code, status) => Object.assign(new Error(code), {code, status});

function validFolderId(id) {
  if (typeof id !== 'string' || !id) return false;
  return id.split('/').every(segment => {
    if (!segment || segment === '.' || segment === '..') return false;
    try {
      const decoded = decodeURIComponent(segment);
      return !/[\u0000-\u001f\u007f]/.test(decoded) && encodeURIComponent(decoded) === segment;
    } catch { return false; }
  });
}

function requireFolderId(id) {
  if (!validFolderId(id)) throw failure('FOLDER_ID_INVALID', 400);
}

function requirePolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) ||
      policy.schemaVersion !== 1 || !Number.isSafeInteger(policy.revision) || policy.revision < 1 ||
      !Array.isArray(policy.disabled) || !Array.from(policy.disabled).every(validFolderId)) {
    throw failure('FOLDER_POLICY_INVALID', 503);
  }
}

/** Throws for malformed policy and disabled ancestors. */
export function assertFolderReadable(policy, id) {
  requireFolderId(id);
  requirePolicy(policy);
  const disabled = new Set(policy.disabled);
  const parts = id.split('/');
  for (let length = 1; length <= parts.length; length++) {
    if (disabled.has(parts.slice(0, length).join('/'))) throw failure('FOLDER_DISABLED', 403);
  }
}

/** Malformed policy fails closed. */
export function folderReadable(policy, id) {
  try { assertFolderReadable(policy, id); return true; }
  catch { return false; }
}

/**
 * readPolicy must fetch fresh, authoritative control metadata on every call.
 * readContent must return a buffered result, with no streaming, delivery or other
 * externally visible side effects: the second check can withhold its result,
 * but cannot undo a content read already started before a policy change.
 */
export function createFolderReadGuard({readPolicy} = {}) {
  if (typeof readPolicy !== 'function') throw failure('FOLDER_READ_GUARD_INVALID', 500);
  async function check(id) {
    let policy;
    try { policy = await readPolicy(); }
    catch { throw failure('FOLDER_POLICY_UNAVAILABLE', 503); }
    assertFolderReadable(policy, id);
  }
  return async function guard(id, readContent) {
    requireFolderId(id);
    if (typeof readContent !== 'function') throw failure('FOLDER_READ_GUARD_INVALID', 500);
    await check(id);
    const content = await readContent();
    await check(id);
    return content;
  };
}
