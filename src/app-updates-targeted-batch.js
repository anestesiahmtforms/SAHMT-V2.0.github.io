export async function requestUpdatesForUsers({users, release, sendBatch, onProgress = () => {}, isCurrent = () => true}) {
  if (!Number.isSafeInteger(release) || release <= 0) throw Error('APP_UPDATE_RELEASE_INVALID');
  const selected = [...new Set(users.filter(user => user.active === true && user.access === true).map(user => user.uid))];
  let sent = 0;
  try {
    for (let i = 0; i < selected.length; i += 200) {
      if (!isCurrent()) throw Error('APP_UPDATE_SESSION_CHANGED');
      const batch = selected.slice(i, i + 200);
      await sendBatch(batch, release); sent += batch.length; onProgress({sent, total: selected.length});
    }
  } catch (error) {throw Object.assign(Error('APP_UPDATE_BATCH_INCOMPLETE'), {cause: error, sent, total: selected.length});}
  return {sent, total: selected.length};
}
