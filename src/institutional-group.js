// Descriptive affiliation only: administrator/manager status never assigns a group.
export const INSTITUTIONAL_GROUPS = Object.freeze({team:'Equipe',resident:'Residentes',substitute:'Substitutos'});
export function institutionalGroup(categories) {
  if (!Array.isArray(categories) || new Set(categories).size !== categories.length) return null;
  const affiliations = categories.filter(id => ['EFETIVO','RESIDENTE_1','RESIDENTE_2','RESIDENTE_3','SUBSTITUTO'].includes(id));
  if (affiliations.length !== 1 || categories.some(id => !['EFETIVO','RESIDENTE_1','RESIDENTE_2','RESIDENTE_3','SUBSTITUTO','ADMINISTRADOR','GESTOR'].includes(id))) return null;
  return affiliations[0] === 'EFETIVO' ? 'team' : affiliations[0] === 'SUBSTITUTO' ? 'substitute' : 'resident';
}
export function assignedInstitutionalGroup(assignment, identity) {
  if (!identity?.uid || !identity?.email || assignment?.schemaVersion !== 1 || assignment.identityStatus !== 'LINKED' || assignment.uid !== identity.uid || assignment.email !== identity.email.trim().toLowerCase()) return null;
  return institutionalGroup(assignment.memberCategories);
}
export async function institutionalAssignmentKey(email) {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
