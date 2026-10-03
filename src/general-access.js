export const GENERAL_READ_PERMISSIONS = Object.freeze(['trainingsRead', 'notificationsRead']);

export function withGeneralReadPermissions(permissions = {}, {active = false, access = false} = {}) {
  const result = {...permissions};
  if (active === true && access === true) {
    for (const permission of GENERAL_READ_PERMISSIONS) result[permission] = true;
  }
  return result;
}