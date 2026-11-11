/** Sends immutable FC performance ledger deltas to FK once per day. */
function fcFkLedgerPages_(filters, cutoff) {
  const rows=[];let cursor=null;
  for(;;){
    const page=evaluationQuery_('fcPerformanceLedger',filters,
      [{fieldPath:'createdAt',direction:'ASCENDING'},{fieldPath:'__name__',direction:'ASCENDING'}],1000,
      ['awardId','uid','category','modality','points','createdAt','awardVersion'],null,cursor);
    rows.push.apply(rows,page);
    if(page.length<1000)break;
    const last=page[page.length-1];
    if(!last||typeof last.id!=='string'||!(last.createdAt instanceof Date))throw Error('FC_FK_SOURCE_CURSOR_INVALID');
    const document=firestoreRequest_(evaluationDocumentsUrl_('/fcPerformanceLedger/'+encodeURIComponent(last.id)),{method:'get'});
    const rawTimestamp=document&&document.fields&&document.fields.createdAt&&document.fields.createdAt.timestampValue;
    if(typeof rawTimestamp!=='string')throw Error('FC_FK_SOURCE_CURSOR_INVALID');
    cursor={values:[{timestampValue:rawTimestamp},{referenceValue:evaluationDocumentName_('fcPerformanceLedger',last.id)}],before:false};
  }
  if(rows.length>30000)throw Error('FC_FK_SOURCE_BATCH_LIMIT');
  return rows;
}

function fcFkPerformanceRows_(cutoff, effectiveFrom, since) {
  const eligibleAwards=new Set(fcFkLedgerPages_([
    {field:{fieldPath:'category'},op:'EQUAL',value:{stringValue:'PERFORMANCE'}},
    {field:{fieldPath:'awardVersion'},op:'EQUAL',value:{integerValue:'1'}},
    {field:{fieldPath:'createdAt'},op:'GREATER_THAN_OR_EQUAL',value:{timestampValue:effectiveFrom.toISOString()}},
    {field:{fieldPath:'createdAt'},op:'LESS_THAN',value:{timestampValue:cutoff.toISOString()}}
  ],cutoff).map(entry=>entry.awardId).filter(id=>typeof id==='string'));
  const deltas=fcFkLedgerPages_([
    {field:{fieldPath:'category'},op:'EQUAL',value:{stringValue:'PERFORMANCE'}},
    {field:{fieldPath:'createdAt'},op:'GREATER_THAN_OR_EQUAL',value:{timestampValue:new Date(since).toISOString()}},
    {field:{fieldPath:'createdAt'},op:'LESS_THAN',value:{timestampValue:cutoff.toISOString()}}
  ],cutoff);
  const rows=[];
  for(const entry of deltas){
    if(!eligibleAwards.has(entry.awardId))continue;
    if(typeof entry.uid!=='string'||!/^[A-Za-z0-9_.@+:%-]{1,128}$/.test(entry.uid)||
      entry.category!=='PERFORMANCE'||!Number.isFinite(entry.points)||Math.abs(entry.points)>1000000||
      !(entry.createdAt instanceof Date)||entry.createdAt.getTime()<effectiveFrom.getTime()||
      entry.createdAt.getTime()<since||entry.createdAt>=cutoff||!Number.isSafeInteger(entry.awardVersion)||entry.awardVersion<1)
      throw Error('FC_FK_SOURCE_ROW_INVALID');
    const label={OCCURRENCE:'Ocorrência',ACKNOWLEDGEMENT:'Ciência institucional',SUGGESTION:'Sugestão'}[entry.modality];
    if(!label)throw Error('FC_FK_SOURCE_MODALITY_INVALID');
    rows.push({id:entry.id,uid:entry.uid,category:'RECORDS',points:entry.points,
      createdAt:entry.createdAt.getTime(),label:label});
  }
  return rows;
}
function fcPublishPerformanceToFk_(){
  const now=new Date(),day=Utilities.formatDate(now,'America/Sao_Paulo','yyyy-MM-dd');
  const clock=Utilities.formatDate(now,'America/Sao_Paulo','HH:mm');
  if(clock<'00:00'||clock>'00:30')return {code:'FC_FK_PUSH_NOT_DUE'};
  const properties=PropertiesService.getScriptProperties();
  if(properties.getProperty('FK_FC_PERFORMANCE_LAST_PUSH_DAY')===day)return {code:'FC_FK_PUSH_ALREADY_DONE'};
  const runtime=fcPerformanceRuntime_(),cutoff=new Date(),effectiveFrom=new Date(Math.max(runtime.effectiveFrom.getTime(),Date.parse('2026-12-01T03:00:00.000Z')));
  const previous=Number(properties.getProperty('FK_FC_PERFORMANCE_LAST_PUSH')||0);
  const since=Math.max(effectiveFrom.getTime(),previous);
  if(!Number.isSafeInteger(since)||since>=cutoff.getTime())throw Error('FC_FK_SOURCE_CURSOR_INVALID');
  const rows=fcFkPerformanceRows_(cutoff,effectiveFrom,since);
  const result=fkPushPerformanceSourceSnapshot_('FC',cutoff.getTime(),effectiveFrom.getTime(),rows);
  properties.setProperties({FK_FC_PERFORMANCE_LAST_PUSH:String(cutoff.getTime()),FK_FC_PERFORMANCE_LAST_PUSH_DAY:day},false);
  return result;
}
