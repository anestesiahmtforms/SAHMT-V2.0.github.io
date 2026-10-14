import {isValidDateKey} from './schedule-date.js';

function milliseconds(value) {
  const time=value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : Date.parse(value || ''));
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

/** Presentation only. Existing server validation remains responsible for points. */
export function checklistConferenceDisplay({day,uid,ownSigla,signatures=[],request=null}={}) {
  const saved=signatures.filter(item=>item.date===day&&item.declaration===true&&
    typeof item.signerUid==='string'&&item.signerUid&&typeof item.signerName==='string'&&item.signerName.trim())
    .sort((a,b)=>milliseconds(a.acknowledgedAt||a.signedAt)-milliseconds(b.acknowledgedAt||b.signedAt)||String(a.id).localeCompare(String(b.id)))[0];
  if(saved)return {signerName:saved.signerName.trim(),kind:saved.responsibleUid
    ? saved.signerUid===saved.responsibleUid?'scheduled':'alternate':'recorded',validated:true};
  if(request?.day!==day||request.signerUid!==uid||request.recordKind!=='ACKNOWLEDGEMENT'||
    request.declaration!==true||typeof request.signerName!=='string'||!request.signerName.trim())return null;
  const sigla=String(ownSigla||'').trim().toUpperCase();
  const known=/^(?:[A-Z]{2}|L2)$/.test(sigla)&&/^(?:[A-Z]{2}|L2)$/.test(request.rotationSigla||'');
  return {signerName:request.signerName.trim(),kind:known?(sigla===request.rotationSigla?'scheduled':'alternate'):'recorded',validated:false};
}

/** One scoped day query and the caller's own request; never enumerates private requests. */
export function createChecklistConferenceListener(options,onNext,onError,{sdk,db}={}) {
  const {uid,day,ownSigla,readSignatures=true}=options||{};
  if(!uid||typeof uid!=='string'||!isValidDateKey(day))throw Error('Conferência sem sessão ou data válida.');
  const sources=[{key:'request',reference:sdk.doc(db,'checklistSignatureRequests',`${day}_${uid}`)}];
  if(readSignatures)sources.push({key:'signatures',reference:sdk.query(sdk.collection(db,'checklistSignatures'),
    sdk.where('date','==',day),sdk.limit(101))});
  const states=new Map(sources.map(({key})=>[key,{ready:false,fromCache:true,pending:false}]));
  let stopped=false,signatures=[],request=null;const stops=[];
  const publish=()=>{
    if(stopped)return;
    const values=[...states.values()],error=values.find(value=>value.error)?.error||null;
    onNext({ready:values.every(value=>value.ready),fromCache:values.some(value=>value.fromCache),
      hasPendingWrites:values.some(value=>value.pending),error,
      confirmation:checklistConferenceDisplay({day,uid,ownSigla,signatures,request})});
  };
  const stop=()=>{stopped=true;for(const unsubscribe of stops.splice(0))unsubscribe();};
  try {
    for(const {key,reference} of sources)stops.push(sdk.onSnapshot(reference,{includeMetadataChanges:true},snapshot=>{
      if(stopped)return;
      const pending=snapshot.metadata?.hasPendingWrites===true;
      if(key==='request')request=!pending&&snapshot.exists()?{id:snapshot.id,...snapshot.data()}:null;
      else signatures=snapshot.docs.filter(item=>!item.metadata?.hasPendingWrites).map(item=>({id:item.id,...item.data()}));
      const truncated=key==='signatures'&&snapshot.docs.length>100;
      states.set(key,{ready:true,fromCache:snapshot.metadata?.fromCache!==false,pending,
        error:truncated?Error('Conferências do dia requerem revisão.'):null});publish();
    },error=>{if(stopped)return;states.set(key,{ready:true,fromCache:true,error});publish();onError?.(error);}));
  }catch(error){stop();throw error;}
  return stop;
}

export async function watchChecklistConference(options,onNext,onError) {
  const [sdk,{db}]=await Promise.all([import('firebase/firestore'),import('./firebase.js')]);
  return createChecklistConferenceListener(options,onNext,onError,{sdk,db});
}
