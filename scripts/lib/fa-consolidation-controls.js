import {snapshotDigest} from './management-split-plan.js';
const allowed={
 'sahmt-17a16':new Set(['managementRuntime/faConsolidation','managementRuntime/domainCutover']),
 'sahmt-gestao-5ae66':new Set(['managementRuntime/domainCutover'])
};
const demand=(value,code)=>{if(!value)throw Error(code);};
/** Only the three reviewed runtime documents, masked CAS patches. */
export function createConsolidationControls({getToken,fetchImpl=fetch}={}){
 demand(typeof getToken==='function','CONSOLIDATION_CONTROL_TOKEN_REQUIRED');
 const base=(project,path)=>'projects/'+project+'/databases/(default)/documents/'+path;
 const call=async(project,path,body)=>{
  demand(allowed[project]?.has(path),'CONSOLIDATION_CONTROL_PATH_FORBIDDEN');
  const token=await getToken(project);
  const response=await fetchImpl('https://firestore.googleapis.com/v1/'+(body?'projects/'+project+'/databases/(default)/documents:commit':base(project,path)),{
   method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!body&&response.status===404)return null;
  demand(response.ok,'CONSOLIDATION_CONTROL_HTTP_'+response.status);
  return response.json();
 };
 return Object.freeze({read:(project,path)=>call(project,path),async patch(write,previous){
  const {projectId,path,fields}=write||{};
  demand(allowed[projectId]?.has(path)&&fields&&Object.keys(fields).length>0,'CONSOLIDATION_CONTROL_PATH_FORBIDDEN');
  demand(previous===null||(previous&&previous.name===base(projectId,path)
   &&typeof previous.updateTime==='string'&&Number.isFinite(Date.parse(previous.updateTime))),
   'CONSOLIDATION_CONTROL_PRECONDITION_INVALID');
  const mask=Object.keys(fields).sort();
  demand(mask.every(key=>/^[A-Za-z][A-Za-z0-9]*$/.test(key)),'CONSOLIDATION_CONTROL_FIELDS_INVALID');
  const response=await call(projectId,path,{writes:[{update:{name:base(projectId,path),fields},
   updateMask:{fieldPaths:mask},currentDocument:previous?{updateTime:previous.updateTime}:{exists:false}}]});
  demand(response?.writeResults?.length===1,'CONSOLIDATION_CONTROL_COMMIT_INVALID');
  const stored=await call(projectId,path);
  demand(stored&&mask.every(key=>snapshotDigest(stored.fields?.[key])===snapshotDigest(fields[key])),'CONSOLIDATION_CONTROL_POSTCHECK_FAILED');
  return stored;
 }});
}
