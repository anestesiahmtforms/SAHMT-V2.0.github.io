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
    const result = await withOperationalDeadline(sendRemote, timeoutMs);
    if (!result.pendingFirestore) await clearLocal();
    return result;
  } catch (error) {
    await onFailure(error);
    if (recoverable(error)) return {id, pendingFirestore: true};
    throw error;
  }
}
