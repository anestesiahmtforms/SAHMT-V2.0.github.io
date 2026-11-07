const validUid=value=>typeof value==='string'&&/^[^\s/]{1,128}$/.test(value);
const pending=()=>Object.assign(new Error('A pontuação de FG ainda está aguardando confirmação.'),{code:'FG_PERFORMANCE_PENDING'});
export async function loadFgPerformance({database,sdk,uid,subjectUid=uid,isCurrent=()=>true}){
  if(!validUid(uid)||!validUid(subjectUid)||!isCurrent())throw pending();
  const {doc,collection,query,where,orderBy,limit,getDoc,getDocs}=sdk;
  const runtime=await getDoc(doc(database,'fgPerformanceRuntime','state'));
  if(!isCurrent()||!runtime.exists())throw pending();
  const state=runtime.data();
  if(state.status!=='ACTIVE'||state.projectId!=='sahmt-checklist-fg'||state.rule!=='FG_DAILY_TEAM_ACKNOWLEDGEMENT_TRANSFER_V1'||!state.activatedAt)throw pending();
  const [profileRows,summaryRows,ledgerRows]=await Promise.all([
    getDocs(query(collection(database,'users'),limit(401))),
    getDocs(query(collection(database,'fgPerformanceSummaries'),limit(401))),
    getDocs(query(collection(database,'fgPerformanceLedger'),where('uid','==',subjectUid),orderBy('createdAt','desc'),limit(200)))
  ]);
  if(!isCurrent()||profileRows.docs.length>400||summaryRows.docs.length>400)throw pending();
  const members=profileRows.docs.map(document=>({...document.data(),id:document.id})).filter(p=>p.uid===p.id&&p.active===true&&p.access===true);
  if(!members.some(p=>p.uid===subjectUid))throw Object.assign(new Error('Profissional indisponível em FG.'),{code:'FG_PERFORMANCE_SUBJECT_UNAVAILABLE'});
  const totals=new Map(summaryRows.docs.map(document=>{
    const value=document.data();if(value.uid!==document.id||!Number.isSafeInteger(value.points))throw pending();return [document.id,value.points];
  }));
  const team=members.map(p=>({uid:p.uid,displayName:p.displayName||p.uid,total:totals.get(p.uid)||0})).sort((a,b)=>a.displayName.localeCompare(b.displayName,'pt-BR'));
  const ledger=ledgerRows.docs.map(document=>({...document.data(),id:document.id}));
  if(ledger.some(row=>row.uid!==subjectUid||![-1,1].includes(row.delta)||row.sourceType!=='CHECKLIST'||row.sourceProjectId!=='sahmt-checklist-fg'))throw pending();
  const activatedAt=state.activatedAt.toDate?.()||new Date(state.activatedAt);
  if(!Number.isFinite(activatedAt.getTime()))throw pending();
  return {summary:team.find(p=>p.uid===subjectUid),team,ledger,effectiveFrom:activatedAt.toISOString()};
}
export async function readFgPerformance({uid,subjectUid=uid,isCurrent=()=>true}){
  const [{getOperationalModuleDatabase},sdk]=await Promise.all([import('./operational-module-firebase.js'),import('firebase/firestore/lite')]);
  const database=await getOperationalModuleDatabase('FG',uid);
  return loadFgPerformance({database,sdk,uid,subjectUid,isCurrent});
}
