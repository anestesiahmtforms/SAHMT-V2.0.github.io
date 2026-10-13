export const FIRST_LOGIN_COHORTS = Object.freeze(['OPERATIONAL', 'STRUCTURAL', 'HOMOLOGATION', 'REVIEW']);
export const PROTECTED_FIRST_LOGIN_COHORTS = Object.freeze(['STRUCTURAL', 'HOMOLOGATION']);

export function isFirstLoginCohort(value) {
  return FIRST_LOGIN_COHORTS.includes(value);
}

export function firstLoginCohortForDisplay(value) {
  return isFirstLoginCohort(value) ? value : 'REVIEW';
}

export function canReclassifyFirstLoginCohort(current, next) {
  if (!isFirstLoginCohort(next)) return false;
  if (current !== undefined && !isFirstLoginCohort(current)) return false;
  return !PROTECTED_FIRST_LOGIN_COHORTS.includes(current) || current === next;
}

export function firstLoginCohortAdminEnabled(env = import.meta.env) {
  return env?.VITE_MANAGEMENT_FIRST_LOGIN_COHORT_ADMIN_ENABLED === 'true';
}
