const endpoint='https://sahmt-fa-performance.anestesiahmtforms.workers.dev/v1/fa-performance';
export async function readFaPerformance({auth,subjectUid,isCurrent,fetchImpl=fetch}){
 const user=auth?.currentUser,current=()=>isCurrent()&&auth.currentUser===user&&auth.app.options.projectId==='sahmt-17a16';
 if(!user||!current())throw Error('FA_SESSION_CHANGED');const token=await user.getIdToken();if(!current())throw Error('FA_SESSION_CHANGED');
 const r=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'GET_PERFORMANCE',input:{subjectUid}}),credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000)});
 if(!current()){await r.body?.cancel();throw Error('FA_SESSION_CHANGED');}const body=await r.json();
 if(!r.ok)throw Object.assign(Error(body.code||'FA_UNAVAILABLE'),{status:r.status});
 if(body.sourceProjectId!=='sahmt-17a16'||body.summary?.uid!==subjectUid||!Number.isFinite(body.summary.total)||body.reference?.status!=='CONFIRMED'||body.summary.revision!==body.reference.revision||!Array.isArray(body.team)||!Array.isArray(body.awards)||!Array.isArray(body.ledger))throw Error('FA_RESPONSE_INVALID');return body;
}
