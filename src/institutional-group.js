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
  // Match member-category-plan: document IDs hash the JSON string, including
  // its quotes, rather than the raw address. Never create alternate aliases.
  const bytes = new TextEncoder().encode(JSON.stringify(email.trim().toLowerCase()));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}

export async function resolveAuthenticatedInstitutionalGroup({user,readAssignment}) {
 if(!user?.uid||!user.email||!user.emailVerified||!user.providerData?.some(p=>p.providerId==='google.com'))throw Error('REGISTRY_UNAVAILABLE');
 const group=assignedInstitutionalGroup(await readAssignment(await institutionalAssignmentKey(user.email)),{uid:user.uid,email:user.email});
 if(!group)throw Error('REGISTRY_UNAVAILABLE');return researchGroup(group);
}

// Public research cohorts; internal affiliation remains unchanged for other modules.
export const researchGroup=value=>value==='substitute'?'team':['team','resident'].includes(value)?value:null;
