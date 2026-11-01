// CENTRAL project only. This file is a reviewed candidate, not part of the FC bundle.
function fcCentralPerformanceStopped_(){return PropertiesService.getScriptProperties().getProperty('SAHMT_FC_PERFORMANCE_MODE')==='FC_ONLY';}
function conferirCorteCentralFcV1(){
  const owner='anestesiahmtforms@gmail.com',email=function(user){return String(user&&user.getEmail()||'').trim().toLowerCase();};
  if(ScriptApp.getScriptId()!=='1ReIZEXaVspXDYFP3u5g4pJNPKVOsrafNWACmsPVIbgq85Zav9sjkR4bD'||email(Session.getEffectiveUser())!==owner||email(Session.getActiveUser())!==owner)throw Error('FC_CENTRAL_OWNER_REQUIRED');
  const props=PropertiesService.getScriptProperties(),safeKeys=['SAHMT_FC_PERFORMANCE_MODE','SAHMT_FC_PERFORMANCE_STOPPED_AT','SAHMT_V2_OCCURRENCE_SCORING_ENABLED','QMENTUM_QUARTERLY_ENABLED'];
  const values={};safeKeys.forEach(function(k){values[k]=props.getProperty(k);});
  const result={code:'FC_CENTRAL_CUTOVER_STATUS',properties:values,triggers:ScriptApp.getProjectTriggers().map(function(t){return t.getHandlerFunction();}).sort(),urlFetchCalls:0,businessWrites:0};console.log(JSON.stringify(result));return result;
}
function pararPontuacaoCentralFcV1(){
  const owner='anestesiahmtforms@gmail.com',email=function(user){return String(user&&user.getEmail()||'').trim().toLowerCase();};
  if(ScriptApp.getScriptId()!=='1ReIZEXaVspXDYFP3u5g4pJNPKVOsrafNWACmsPVIbgq85Zav9sjkR4bD'||email(Session.getEffectiveUser())!==owner||email(Session.getActiveUser())!==owner)throw Error('FC_CENTRAL_OWNER_REQUIRED');
  const props=PropertiesService.getScriptProperties(),old=props.getProperty('SAHMT_FC_PERFORMANCE_STOPPED_AT');
  if(old&&!Number.isFinite(new Date(old).getTime()))throw Error('FC_CENTRAL_MARKER_INVALID');
  const stoppedAt=old||new Date().toISOString(),values={SAHMT_FC_PERFORMANCE_MODE:'FC_ONLY',SAHMT_FC_PERFORMANCE_STOPPED_AT:stoppedAt,SAHMT_V2_OCCURRENCE_SCORING_ENABLED:'false',QMENTUM_QUARTERLY_ENABLED:'false'};
  props.setProperties(values,false);Object.keys(values).forEach(function(k){if(props.getProperty(k)!==values[k])throw Error('FC_CENTRAL_STOP_READBACK_FAILED');});
  const result={code:'FC_CENTRAL_PERFORMANCE_STOPPED',mode:'FC_ONLY',stoppedAt:stoppedAt,activateNotBefore:new Date(new Date(stoppedAt).getTime()+420000).toISOString(),
    occurrenceScoringEnabled:false,quarterlyEnabled:false,triggers:ScriptApp.getProjectTriggers().map(function(t){return t.getHandlerFunction();}).sort(),businessWrites:0};
  console.log(JSON.stringify(result));return result;
}
