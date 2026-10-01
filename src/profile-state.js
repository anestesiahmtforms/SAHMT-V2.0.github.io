export function createProfileStatePublisher({user, isCurrent, onState, cacheProfile, onCacheError = () => {}}) {
  let snapshotSequence = 0;
  let cacheWrites = Promise.resolve();

  return {
    publish(profile, {offline = false} = {}) {
      if (!isCurrent()) return Promise.resolve(false);
      const sequence = ++snapshotSequence;
      // Access must change before any optional IndexedDB work can block it.
      onState({status: profile.active === true && profile.access === true ? 'signed-in' : 'blocked', user, profile, offline});
      const write = cacheWrites.then(async () => {
        if (!isCurrent() || sequence !== snapshotSequence) return false;
        try {
          await cacheProfile(user.uid, profile);
          return true;
        } catch (error) {
          onCacheError(error);
          return false;
        }
      });
      cacheWrites = write.catch(() => {});
      return write;
    }
  };
}
