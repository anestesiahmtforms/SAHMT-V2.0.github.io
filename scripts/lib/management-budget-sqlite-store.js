const PROJECTS = new Set(['sahmt-17a16', 'sahmt-gestao-5ae66']);
const TABLE = 'sahmt_management_read_budget';
class StoreError extends Error { constructor(code) { super(code); this.code = code; } }
const requireValue = (condition, code) => { if (!condition) throw new StoreError(code); };
const plain = value => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const jsonOnly = (value, depth = 0) => {
  requireValue(depth <= 64, 'BUDGET_STATE_INVALID');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { requireValue(Number.isFinite(value), 'BUDGET_STATE_INVALID'); return; }
  requireValue(Array.isArray(value) || plain(value), 'BUDGET_STATE_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireValue(Reflect.ownKeys(descriptors).every(key => typeof key === 'string'), 'BUDGET_STATE_INVALID');
  if (Array.isArray(value)) requireValue(Object.keys(value).length === value.length
    && Object.keys(value).every(key => /^(?:0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length), 'BUDGET_STATE_INVALID');
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue;
    requireValue(Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true, 'BUDGET_STATE_INVALID');
    jsonOnly(descriptor.value, depth + 1);
  }
};
const encode = (value, maximum) => {
  jsonOnly(value);
  const text = JSON.stringify(value);
  requireValue(typeof text === 'string' && new TextEncoder().encode(text).byteLength <= maximum, 'BUDGET_STATE_CAPACITY_EXCEEDED');
  return text;
};
const decode = (text, maximum) => {
  requireValue(typeof text === 'string' && new TextEncoder().encode(text).byteLength <= maximum, 'BUDGET_STATE_INVALID');
  let value;
  try { value = JSON.parse(text); } catch { throw new StoreError('BUDGET_STATE_INVALID'); }
  jsonOnly(value); return value;
};

/** SQL adapter only: no binding, network, Firestore, or default deployment. */
export function createManagementSqliteStore({storage, maxStateBytes, now = Date.now} = {}) {
  requireValue(storage && typeof storage.transactionSync === 'function'
    && typeof storage.sql?.exec === 'function', 'BUDGET_SQLITE_STORAGE_REQUIRED');
  requireValue(Number.isSafeInteger(maxStateBytes) && maxStateBytes >= 1024
    && maxStateBytes <= 1024 * 1024 && typeof now === 'function', 'BUDGET_SQLITE_POLICY_REQUIRED');
  let initialized = false;
  const live = context => {
    const time = now();
    requireValue(Number.isSafeInteger(time) && time >= 0, 'BUDGET_STORAGE_CLOCK_INVALID');
    if (context?.signal) {
      requireValue(typeof context.signal.aborted === 'boolean', 'BUDGET_STORAGE_CONTEXT_INVALID');
      requireValue(context.signal.aborted === false, 'BUDGET_STORAGE_CANCELLED');
    }
    if (context?.deadlineMs !== undefined) {
      requireValue(Number.isSafeInteger(context.deadlineMs) && context.deadlineMs >= 0, 'BUDGET_STORAGE_CONTEXT_INVALID');
      requireValue(time < context.deadlineMs, 'BUDGET_STORAGE_DEADLINE_EXCEEDED');
    }
  };
  const transact = async (projectId, transform, context = {}) => {
    requireValue(PROJECTS.has(projectId) && typeof transform === 'function', 'BUDGET_STORAGE_REQUEST_INVALID');
    live(context);
    try {
      const result = storage.transactionSync(() => {
        live(context);
        if (!initialized) {
          storage.sql.exec('CREATE TABLE IF NOT EXISTS ' + TABLE + ' (project_id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
        }
        const rows = Array.from(storage.sql.exec('SELECT payload FROM ' + TABLE + ' WHERE project_id = ?', projectId));
        requireValue(rows.length <= 1, 'BUDGET_STATE_INVALID');
        const current = rows.length ? decode(rows[0].payload, maxStateBytes) : null;
        if (rows.length) requireValue(plain(current), 'BUDGET_STATE_INVALID');
        const next = transform(current);
        requireValue(plain(next) && typeof next.then !== 'function'
          && Object.hasOwn(next, 'state') && Object.hasOwn(next, 'result'), 'BUDGET_TRANSFORM_INVALID');
        const state = encode(next.state, maxStateBytes), output = encode(next.result, maxStateBytes);
        requireValue(next.state !== null && plain(next.state), 'BUDGET_STATE_INVALID');
        live(context);
        if (!rows.length || rows[0].payload !== state)
          storage.sql.exec('INSERT INTO ' + TABLE + ' (project_id, payload) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET payload = excluded.payload', projectId, state);
        live(context); // Throwing here rolls back the entire transaction.
        return JSON.parse(output);
      });
      requireValue(!result || typeof result.then !== 'function', 'BUDGET_SQLITE_ASYNC_TRANSACTION_DENIED');
      initialized = true;
      live(context); // A late commit is retained; it never yields an admissible receipt.
      return result;
    } catch (error) {
      if (error instanceof StoreError) throw error;
      throw new StoreError('BUDGET_SQLITE_UNAVAILABLE');
    }
  };
  return Object.freeze({transact});
}
