import {createVaccinationService} from '../worker-training/vaccination-service.js';
import {assignedInstitutionalGroup,institutionalAssignmentKey,institutionalGroup} from '../src/institutional-group.js';
import {createVaccinationProofService} from './vaccination-proofs.js';
import {awardUpdatedVaccinations} from './vaccination-performance.js';

const root = 'consultas/biosseguranca';
const fail = (code,status=403) => { throw Object.assign(Error(code),{code,status}); };

export function createFeBiosafetyService({store,checkFolder,now=Date.now}) {
  async function checkAccess(tx,identity,profile,folder) {
    const email = identity?.email?.trim().toLowerCase();
    if (identity?.provider !== 'google.com' || identity.emailVerified !== true ||
        !/^[A-Za-z0-9_.@+:%-]{1,128}$/.test(identity.uid || '') || !email?.includes('@')) fail('VAC_UNAUTHENTICATED',401);
    if (profile?.active !== true || profile.access !== true || profile.uid !== identity.uid ||
        profile.email?.trim().toLowerCase() !== email) fail('VAC_FORBIDDEN');
    const assignment = await tx.get('userCategories',await institutionalAssignmentKey(email));
    if (assignedInstitutionalGroup(assignment,{uid:identity.uid,email}) !== 'team') fail('VAC_FORBIDDEN');
    if (profile.role !== 'administrador_app' && profile.permissions?.admin !== true)
      await checkFolder(root+'/'+folder,tx);
    return profile;
  }
  const vaccinationAccess = (tx,identity,profile) => checkAccess(tx,identity,profile,'vacinacao');
  const vaccination = createVaccinationService({
    store,now,authorizeAccess:vaccinationAccess,
    eligibleParticipant:profile=>profile.active===true&&profile.access===true&&institutionalGroup(profile.memberCategories)==='team',
    onSaved:awardUpdatedVaccinations
  });
  const documents = createVaccinationProofService({
    store,now,authorize:async(tx,identity)=>vaccinationAccess(tx,identity,await tx.get('users',identity.uid))
  });
  const services = {vaccination,documents};
  return {
    async execute(action,input,identity) {
      if(input?.kind==='dosimetry')fail('DOSIMETRY_MOVED_TO_FK',410);
      if (!input || !Object.hasOwn(services,input.kind) || Object.keys(input).length!==2 ||
          !input.payload || typeof input.payload!=='object' || Array.isArray(input.payload)) fail('VAC_INVALID_INPUT',400);
      return services[input.kind].execute(action,input.payload,identity);
    }
  };
}