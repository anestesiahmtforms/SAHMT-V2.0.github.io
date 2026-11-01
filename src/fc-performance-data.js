export const FC_PERFORMANCE_PROJECT = 'indicadores---sahmt';
export const fcPerformanceEnabled = import.meta.env?.VITE_FC_PERFORMANCE_ENABLED === 'true';
const validUid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
function sessionValid({db,auth,uid,isCurrent}){
 return validUid(uid)&&db?.app?.options?.projectId===FC_PERFORMANCE_PROJECT&&auth?.app?.options?.projectId===FC_PERFORMANCE_PROJECT
  &&auth.currentUser?.uid===uid&&isCurrent();
}
const profileValid=(profile,uid)=>profile?.uid===uid&&profile.active===true&&profile.access===true;

export function createFcPerformanceRepository({db,auth,uid,firestore,isCurrent=()=>true}={}){
 const binding={db,auth,uid,isCurrent};
 return Object.freeze({watch({onData,onError}={}){
  let closed=false;const releases=[],values=new Map(),metadata=new Map();
  const stop=()=>{if(closed)return;closed=true;releases.splice(0).forEach(release=>release());values.clear();metadata.clear();};
  const fail=error=>{if(closed)return;stop();onError?.(error);};
  const assert=()=>{if(!sessionValid(binding))throw Error('FC_PERFORMANCE_SESSION_INVALID');};
  Promise.resolve().then(async()=>{
   if(closed)return;assert();const sdk=firestore||await import('firebase/firestore');if(closed)return;assert();
   const profile=await sdk.getDocFromServer(sdk.doc(db,'users',uid));if(closed)return;assert();
   if(!profileValid(profile.exists()?profile.data():null,uid))throw Error('FC_PERFORMANCE_ACCESS_REVOKED');
   const requests=[
    ['profile',sdk.doc(db,'users',uid),false],['runtime',sdk.doc(db,'fcPerformanceRuntime','state'),false],
    ['reference',sdk.doc(db,'fcPerformanceReference','team'),false],['summary',sdk.doc(db,'fcPerformanceSummaries',uid),false],
    ...['awards','ledger'].map(kind=>[kind,sdk.query(sdk.collection(db,kind==='awards'?'fcPerformanceAwards':'fcPerformanceLedger'),
     sdk.where('uid','==',uid),sdk.where('category','==','PERFORMANCE'),sdk.orderBy(kind==='awards'?'updatedAt':'createdAt','desc'),sdk.limit(200)),true])
   ];
   for(const [key,ref,list]of requests){
    if(closed)break;
    const release=sdk.onSnapshot(ref,{includeMetadataChanges:true},snapshot=>{
     if(closed)return;
     try{
      assert();const data=list?snapshot.docs.map(doc=>({...doc.data(),id:doc.id})):(snapshot.exists()?snapshot.data():null);
      if(key==='profile'&&!profileValid(data,uid))throw Error('FC_PERFORMANCE_ACCESS_REVOKED');
      if(list&&data.some(row=>row.uid!==uid||row.category!=='PERFORMANCE'))throw Error('FC_PERFORMANCE_RECORD_SCOPE_INVALID');
      values.set(key,data);metadata.set(key,snapshot.metadata||{});
      if(values.size===requests.length){
       const snapshot={uid,runtime:values.get('runtime'),reference:values.get('reference'),summary:values.get('summary'),
        awards:values.get('awards'),ledger:values.get('ledger'),
        fromCache:[...metadata.values()].some(m=>m.fromCache===true),pendingWrites:[...metadata.values()].some(m=>m.hasPendingWrites===true)};
       onData?.(snapshot);
      }
     }catch(error){fail(error);}
    },fail);
    if(closed)release();else releases.push(release);
   }
  }).catch(fail);
  return stop;
 }});
}

export function fcPerformancePresentation(snapshot){
 if(!snapshot||!validUid(snapshot.uid))return{state:'blocked',total:null,percentage:null};
 if(snapshot.summary&&snapshot.summary.uid!==snapshot.uid)return{state:'blocked',total:null,percentage:null};
 if(snapshot.fromCache)return{state:'offline',total:null,percentage:null};
 if(snapshot.runtime?.enabled!==true)return{state:'preparing',total:null,percentage:null};
 if(snapshot.runtime.mode!=='FC_ONLY'||snapshot.runtime.release!=='fc-performance-exclusive-v1')return{state:'blocked',total:null,percentage:null};
 const summary=snapshot.summary,reference=snapshot.reference;
 if(snapshot.pendingWrites||snapshot.runtime.performanceDirty!==false||summary?.status!=='CONFIRMED'||reference?.performanceStatus!=='CONFIRMED'||
  !Number.isSafeInteger(summary.performanceRevision)||summary.performanceRevision!==reference.performanceRevision||
  summary.performanceRevision!==snapshot.runtime.performanceRevision||
  !Number.isFinite(summary.performanceTotal)||!Number.isFinite(reference.maxPerformance)||reference.maxPerformance<0||
  !Number.isSafeInteger(reference.eligibleCount)||reference.eligibleCount<1||reference.maxPerformance===0&&reference.allZero!==true)
  return{state:'pending',total:null,percentage:null};
 const total=summary.performanceTotal,maximum=reference.maxPerformance;
 if(total<0||total>maximum)return{state:'blocked',total:null,percentage:null};
 return{state:'ready',total,percentage:maximum===0?0:Math.round(total/maximum*10000)/100};
}
