function snapshotReportScope(session, getPermissions) {
  const profile = session?.profile || {};
  const permissions = Object.fromEntries(Object.entries(getPermissions(session) || {})
    .filter(([, enabled]) => enabled === true)
    .sort(([left], [right]) => left.localeCompare(right)));
  const scope = {
    uid: session?.user?.uid || '',
    sigla: String(profile.sigla || ''),
    role: String(profile.role || ''),
    permissions: Object.freeze(permissions)
  };
  return {
    ...scope,
    key: JSON.stringify([session?.status || '', scope.uid, profile.active === true,
      profile.access === true, scope.role, scope.sigla,
      Object.keys(permissions)])
  };
}

// Capture before importing readers; callers supply their effective permissions
// and retain their existing route, request and connected-element checks.
export function captureReportReadScope({getSession, getPermissions = current => current?.profile?.permissions,
  isAllowed = () => true, isContextCurrent = () => true}) {
  const captured = snapshotReportScope(getSession(), getPermissions);
  const isCurrent = () => {
    const current = getSession();
    return Boolean(captured.uid && current?.status === 'signed-in' &&
      snapshotReportScope(current, getPermissions).key === captured.key &&
      isAllowed(current) && isContextCurrent());
  };
  return Object.freeze({
    ...captured,
    isCurrent,
    assertCurrent() {
      if (!isCurrent()) {
        throw Object.assign(new Error('Sua sessão ou permissão mudou. Reabra o relatório antes de consultar.'), {code: 'session-changed'});
      }
      return captured.uid;
    }
  });
}
