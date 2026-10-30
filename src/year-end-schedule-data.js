import * as sdk from 'firebase/firestore';
import {onAuthStateChanged} from 'firebase/auth';
import {YEAR_END_CYCLE,YEAR_END_PROJECT,YEAR_END_COLLECTION,validateYearEndChoices,yearEndParticipation,yearEndError} from './year-end-schedule.js';
import {writeYearEndChoices} from './year-end-schedule-transaction.js';
import {institutionalAssignmentKey,assignedInstitutionalGroup} from './institutional-group.js';

export function createYearEndScheduleRepository({db,auth,uid,isCurrent=()=>true,firestore=sdk,watchAuth=onAuthStateChanged}={}) {
  const api=firestore;
  const ensure=()=>{
    if(db?.app?.options?.projectId!==YEAR_END_PROJECT || auth?.app?.options?.projectId!==YEAR_END_PROJECT)
      throw yearEndError('YEAR_END_FE_REQUIRED');
    if(!uid || !isCurrent() || auth.currentUser?.uid!==uid) throw yearEndError('YEAR_END_SESSION_CHANGED');
  };
  ensure();
  const base=[YEAR_END_COLLECTION,YEAR_END_CYCLE];
  const profileRef=api.doc(db,'users',uid);
  const ownRef=api.doc(db,...base,'registrations',uid);
  const counterRef=api.doc(db,...base,'control','order');
  const rowsRef=api.collection(db,...base,'registrations');
  const policyRef=api.doc(db,...base,'policy','participation');
  const profile=async()=>{
    ensure();
    const email=auth.currentUser.email?.trim().toLowerCase();
    if(!email)throw yearEndError('YEAR_END_FORBIDDEN');
    const categoryKey=await institutionalAssignmentKey(email);ensure();
    const assignment=await api.getDocFromServer(api.doc(db,'userCategories',categoryKey));ensure();
    if(!assignment.exists()||assignedInstitutionalGroup(assignment.data(),{uid,email})!=='team')throw yearEndError('YEAR_END_INELIGIBLE');
    const [snapshot,policy]=await Promise.all([api.getDocFromServer(profileRef),api.getDocFromServer(policyRef)]);ensure();
    const p=snapshot.exists()?snapshot.data():null;
    if(p?.uid!==uid || p.active!==true || p.access!==true || p.email?.trim().toLowerCase()!==email)throw yearEndError('YEAR_END_FORBIDDEN');
    return yearEndParticipation(policy.exists()?policy.data():null,uid);
  };
  return {
    uid,
    open:profile,
    subscribe(onChange,onError) {
      ensure();let stopped=false,stopRows=()=>{},stopAuth=()=>{};
      const stop=()=>{if(stopped)return;stopped=true;stopRows();stopAuth();};
      const fail=error=>{if(stopped)return;stop();onError(error);};
      stopRows=api.onSnapshot(api.query(rowsRef,api.orderBy('position','asc')),{includeMetadataChanges:true},snapshot=>{
        if(stopped)return;
        try{ensure();}catch(error){fail(error);return;}
        if(snapshot.metadata.hasPendingWrites)return;
        onChange({rows:snapshot.docs.map(d=>({...d.data(),uid:d.id})),fromCache:snapshot.metadata.fromCache});
      },fail);
      stopAuth=watchAuth(auth,()=>{try{ensure();}catch(error){fail(error);}});
      if(stopped){stopRows();stopAuth();}
      return stop;
    },
    async save(input) {
      const participation=await profile();ensure();
      const choices=validateYearEndChoices(input,participation);
      return writeYearEndChoices({api,db,ownRef,counterRef,uid,sigla:participation.sigla,choices,ensure});
    }
  };
}
