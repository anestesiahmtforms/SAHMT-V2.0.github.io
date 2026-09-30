const isElevated = (profile = {}) => profile.role === 'administrador_app' || profile.permissions?.admin === true;

const truePermissionKeys = (profile = {}) => Object.entries(profile.permissions || {})
  .filter(([, enabled]) => enabled === true)
  .map(([permission]) => permission);

export function sessionChangeRevokesAccess(previous, next) {
  if (!previous || previous.status !== 'signed-in') return false;
  if (next?.status !== 'signed-in' || previous.user?.uid !== next.user?.uid) return true;
  const before = previous.profile || {};
  const after = next.profile || {};
  if (before.active === true && after.active !== true) return true;
  if (before.access === true && after.access !== true) return true;
  if (isElevated(before) && !isElevated(after)) return true;
  if (!isElevated(before) && !isElevated(after) && before.role !== after.role) return true;
  if (isElevated(before) && isElevated(after)) return false;
  const nextPermissions = new Set(truePermissionKeys(after));
  return truePermissionKeys(before).some((permission) => !nextPermissions.has(permission));
}

export function sessionChangeRequiresRender(previous, next) {
  if (!previous || previous.status !== next?.status) return true;
  if (next?.status !== 'signed-in') return false;
  if (previous.user?.uid !== next.user?.uid) return true;

  return sessionChangeRevokesAccess(previous, next);
}

export function sessionChangeGrantsAccess(previous, next) {
  if (!previous || previous.status !== 'signed-in' || next?.status !== 'signed-in') return false;
  if (previous.user?.uid !== next.user?.uid) return false;
  const before = previous.profile || {};
  const after = next.profile || {};
  if (!isElevated(before) && isElevated(after)) return true;
  if (before.active !== true && after.active === true) return true;
  if (before.access !== true && after.access === true) return true;
  const previousPermissions = new Set(truePermissionKeys(before));
  return truePermissionKeys(after).some((permission) => !previousPermissions.has(permission));
}

export function featureChangeRequiresRender(previous, next, route, isRouteEnabled) {
  const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
  if (![...keys].some((key) => previous?.[key] !== next?.[key])) return false;
  return route === 'home' || !isRouteEnabled(route, next);
}
