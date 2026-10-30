import * as sdk from 'firebase/firestore';
import {onAuthStateChanged} from 'firebase/auth';
import {YEAR_END_CYCLE,YEAR_END_PROJECT,YEAR_END_COLLECTION,validateYearEndChoices,yearEndOwnParticipation,yearEndAdministrator,yearEndError} from './year-end-schedule.js';
import {readYearEndTotals} from './year-end-schedule-totals.js';
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
  const totalsRef=api.doc(db,...base,'summary','totals');
  const rowsRef=api.collection(db,...base,'registrations');
  const participationRef=api.doc(db,...base,'participation',uid);
  let access=null;
  const profile=async()=>{
    ensure();
    const email=auth.currentUser.email?.trim().toLowerCase();
    if(!email)throw yearEndError('YEAR_END_FORBIDDEN');
    const categoryKey=await institutionalAssignmentKey(email);ensure();
    const assignment=await api.getDocFromServer(api.doc(db,'userCategories',categoryKey));ensure();
    const category=assignment.exists()?assignment.data():null;
    if(category?.schemaVersion!==1||category.identityStatus!=='LINKED'||category.uid!==uid||category.email!==email)throw yearEndError('YEAR_END_INELIGIBLE');
    const group=assignedInstitutionalGroup(category,{uid,email});
    if(['resident','substitute'].includes(group))throw yearEndError('YEAR_END_INELIGIBLE');
    const [snapshot,projection,summary]=await Promise.all([api.getDocFromServer(profileRef),
      group==='team'?api.getDocFromServer(participationRef):Promise.resolve(null),api.getDocFromServer(totalsRef)]);ensure();
    const p=snapshot.exists()?snapshot.data():null;
    if(p?.uid!==uid || p.active!==true || p.access!==true || p.email?.trim().toLowerCase()!==email)throw yearEndError('YEAR_END_FORBIDDEN');
    const isAdmin=yearEndAdministrator(p,category);
    let participation=null;
    if(group==='team')try{participation=yearEndOwnParticipation(projection?.exists()?projection.data():null);}catch(error){if(!isAdmin)throw error;}
    if(!isAdmin&&!participation)throw yearEndError('YEAR_END_INELIGIBLE');
    if(!summary.exists())throw yearEndError('YEAR_END_SUMMARY_UNAVAILABLE');
    readYearEndTotals(summary.data());
    access={...(participation||{sigla:null,requireGroup:false}),canParticipate:Boolean(participation),isAdmin};
    return access;
  };
  return {
    uid,
    open:profile,
    subscribe(onChange,onError) {
      ensure();if(!access)throw yearEndError('YEAR_END_FORBIDDEN');
      let stopped=false,stopAuth=()=>{};const stops=[],states=new Map();
      const required=1+Number(access.canParticipate)+Number(access.isAdmin);
      const stop=()=>{if(stopped)return;stopped=true;for(const dispose of stops)dispose();stopAuth();states.clear();};
      const fail=error=>{if(stopped)return;stop();onError(error);};
      const watch=(key,ref,decode)=>{
        const dispose=api.onSnapshot(ref,{includeMetadataChanges:true},snapshot=>{
          if(stopped||snapshot.metadata.hasPendingWrites)return;
          try{
            ensure();states.set(key,{value:decode(snapshot),fromCache:snapshot.metadata.fromCache});
            if(states.size===required)onChange({totals:states.get('totals').value,own:states.get('own')?.value||null,
              ...(access.isAdmin?{rows:states.get('rows').value}:{}),fromCache:[...states.values()].some(s=>s.fromCache)});
          }catch(error){fail(error);}
        },fail);
        stops.push(dispose);if(stopped)dispose();
      };
      watch('totals',totalsRef,s=>{if(!s.exists())throw yearEndError('YEAR_END_SUMMARY_UNAVAILABLE');return readYearEndTotals(s.data());});
      if(access.canParticipate&&!stopped)watch('own',ownRef,s=>s.exists()?{...s.data(),uid}:null);
      if(access.isAdmin&&!stopped)watch('rows',api.query(rowsRef,api.orderBy('position','asc')),s=>s.docs.map(d=>({...d.data(),uid:d.id})));
      stopAuth=watchAuth(auth,()=>{try{ensure();}catch(error){fail(error);}});
      if(stopped)stopAuth();
      return stop;
    },
    async save(input) {
      const participation=await profile();ensure();
      if(!participation.canParticipate)throw yearEndError('YEAR_END_FORBIDDEN');
      const choices=validateYearEndChoices(input,participation);
      return writeYearEndChoices({api,db,ownRef,totalsRef,uid,sigla:participation.sigla,choices,ensure});
    }
  };
}
