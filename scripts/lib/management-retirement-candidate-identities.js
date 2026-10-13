const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

export const MANAGEMENT_RETIREMENT_CANDIDATE_EMAILS = Object.freeze(['homologation-a@example.invalid', 'homologation-b@example.invalid']);
export const MANAGEMENT_STRUCTURAL_OWNER_EMAIL = 'fa-owner@example.invalid';

const EMAIL_MARKERS = new Map([
  [MANAGEMENT_STRUCTURAL_OWNER_EMAIL, 'STRUCTURAL_OWNER'],
  [MANAGEMENT_RETIREMENT_CANDIDATE_EMAILS[0], 'HOMOLOGATION_CANDIDATE_1'],
  [MANAGEMENT_RETIREMENT_CANDIDATE_EMAILS[1], 'HOMOLOGATION_CANDIDATE_2']
]);

export const RETIREMENT_IDENTITY_MARKERS = Object.freeze([
  'STRUCTURAL_OWNER', 'HOMOLOGATION_CANDIDATE_1', 'HOMOLOGATION_CANDIDATE_2'
]);

/** Returns a category marker only; callers must not persist or log the input email. */
export function managementIdentityMarkerForEmail(value) {
  return EMAIL_MARKERS.get(normalizeEmail(value)) ?? null;
}

export function managementNormalizeEmail(value) {
  return normalizeEmail(value);
}
