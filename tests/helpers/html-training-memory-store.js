export function memoryStore() {
  const data = new Map(), revisions = new Map();
  const key = (c, id) => `${c}/${id}`;
  const clone = value => value === undefined ? null : structuredClone(value);
  let beforeCommit;
  const store = {
    seed(c, id, value) { const k = key(c, id); data.set(k, clone(value)); revisions.set(k, (revisions.get(k) || 0) + 1); },
    async get(c, id) { return clone(data.get(key(c, id))); },
    async list(c, filters = [], limit = 1000) {
      return [...data.entries()].filter(([k, d]) => k.startsWith(`${c}/`) && filters.every(f =>
        f.op === 'ARRAY_CONTAINS' ? d[f.field]?.includes(f.value) : d[f.field] === f.value)).slice(0, limit).map(([, d]) => clone(d));
    },
    set beforeCommit(fn) { beforeCommit = fn; },
    async transaction(fn) {
      for (let retry = 0; retry < 30; retry++) {
        const reads = new Map(), writes = [];
        const tx = {
          async get(c, id) { const k = key(c, id); reads.set(k, revisions.get(k) || 0); return clone(data.get(k)); },
          set(c, id, value) { writes.push({ c, id, value: clone(value) }); },
          create(c, id, value) { writes.push({ c, id, value: clone(value), create: true }); },
          delete(c, id) { writes.push({ c, id, remove: true }); },
        };
        if (store.batchReads) tx.getMany = async (c, ids) => { store.batchReads.push({ collection: c, count: ids.length }); return Promise.all(ids.map(id => tx.get(c, id))); };
        const result = await fn(tx);
        if (beforeCommit) { const hook = beforeCommit; beforeCommit = null; await hook(); }
        await Promise.resolve();
        if ([...reads].some(([k, rev]) => (revisions.get(k) || 0) !== rev)) continue;
        if (writes.some(w => w.create && data.has(key(w.c, w.id)))) throw new Error('ALREADY_EXISTS');
        for (const w of writes) {
          if (w.remove) data.delete(key(w.c, w.id)); else data.set(key(w.c, w.id), w.value);
          revisions.set(key(w.c, w.id), (revisions.get(key(w.c, w.id)) || 0) + 1);
        }
        return result;
      }
      throw new Error('RETRIES_EXHAUSTED');
    },
  };
  return store;
}

