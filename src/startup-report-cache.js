// Short-lived, single-use memory only: never persists patient report data.
export function createStartupReportCache({now = Date.now, ttl = 30000} = {}) {
  const entries = new Map();
  return {
    warm(key, read) {
      if (entries.has(key)) return entries.get(key).promise;
      const entry = {at: now()};
      entry.promise = Promise.resolve().then(read).then(value => {
        if (value?.stale) throw new Error('Relatório ainda não confirmado pelo servidor.');
        return value;
      });
      entries.set(key, entry);
      entry.promise.catch(() => { if (entries.get(key) === entry) entries.delete(key); });
      return entry.promise;
    },
    take(key) {
      const entry = entries.get(key);
      entries.delete(key);
      return entry && now() - entry.at < ttl ? entry.promise : null;
    },
    clear() { entries.clear(); }
  };
}
