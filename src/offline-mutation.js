export async function withOperationalDeadline(action, timeoutMs = 7000) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('O servidor ainda não confirmou o registro.'), {code: 'deadline-exceeded'})), timeoutMs);
    })]);
  } finally {clearTimeout(timer);}
}

export async function persistOperationalMutation({id, online, saveLocal, sendRemote, clearLocal, recoverable, onFailure = () => {}, timeoutMs}) {
  await saveLocal();
  if (!online) return {id, pendingFirestore: true};
  try {
    const result = await withOperationalDeadline(async () => {
      const committed = await sendRemote();
      // The SDK commit can finish after the UI deadline. Settle its local copy too.
      if (!committed.pendingFirestore) await clearLocal();
      return committed;
    }, timeoutMs);
    return result;
  } catch (error) {
    await onFailure(error);
    if (recoverable(error)) return {id, pendingFirestore: true};
    throw error;
  }
}
