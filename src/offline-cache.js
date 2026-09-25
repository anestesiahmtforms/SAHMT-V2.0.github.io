export async function readThroughSafeCache({uid, kind, id, fetchOnline, readCache, writeCache, mayFallback}) {
  try {
    const value = await fetchOnline();
    if (uid && value !== null && value !== undefined) await writeCache(uid, kind, id, value);
    return value;
  } catch (error) {
    if (!uid || !mayFallback(error)) throw error;
    const cached = await readCache(uid, kind, id);
    if (!cached) throw error;
    if (Array.isArray(cached.data)) {
      const items = cached.data.map((item) => ({...item, stale: true}));
      Object.defineProperty(items, 'stale', {value: true});
      return items;
    }
    if (cached.data && typeof cached.data === 'object') return {...cached.data, stale: true};
    throw error;
  }
}
