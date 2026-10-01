export function createWriteSessionGuard({uid, getSession, isAllowed, isContextCurrent = () => true}) {
  const isCurrent = () => {
    const current = getSession();
    return Boolean(uid && current?.status === 'signed-in' && current.user?.uid === uid &&
      isAllowed(current) && isContextCurrent());
  };
  return {
    uid,
    isCurrent,
    assertCurrent() {
      if (!isCurrent()) {
        throw Object.assign(new Error('Sua sessão ou permissão mudou. Reabra a página antes de salvar.'), {code: 'session-changed'});
      }
      return uid;
    }
  };
}
