// Short-lived, single-use memory only: never persists patient report data.
export function createStartupReportCache({now = Date.now, ttl = 30000} = {}) {
  const entries = new Map();
  const liveEntries = new Map();
  const closeLease = (entry) => {
    const lease = entry?.lease;
    if (entry) entry.lease = null;
    if (lease) { try { lease.close(); } catch { /* Clear ownership even when listener cleanup fails. */ } }
  };
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
    // The caller owns the warm deadline timer; takeLive also checks its age.
    holdLive(key, lease) {
      if (typeof key !== 'string' || !key || !lease?.controller || typeof lease.close !== 'function') throw new TypeError('Informe o escopo e o listener pré-carregado.');
      const previous = liveEntries.get(key);
      if (previous?.lease === lease) return lease;
      liveEntries.delete(key);
      closeLease(previous); // Stop the old owner before registering its replacement.
      liveEntries.set(key, {at: now(), lease});
      return lease;
    },
    takeLive(key) {
      const entry = liveEntries.get(key);
      liveEntries.delete(key);
      if (!entry) return null;
      if (now() - entry.at >= ttl) { closeLease(entry); return null; }
      const lease = entry.lease;
      entry.lease = null; // Transfer once: subsequent clear/expiry cannot close it.
      return lease;
    },
    clear() {
      entries.clear();
      const previous = [...liveEntries.values()];
      liveEntries.clear();
      previous.forEach(closeLease);
    }
  };
}
