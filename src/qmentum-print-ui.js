import {FIELD_LABELS} from './qmentum-catalog.js';
import './qmentum-print-ui.css';

const MAX_IMAGE_BYTES=2*1024*1024;
const MAX_COUNT=10000000;
const TOTALS=['anestheticProcedures','surgical'];
const KINDS=['TECHNIQUES','INDICATORS'];
const CANDIDATE_LABELS={NEW:'Novo',CHANGED:'Alterado',UNCHANGED:'Sem alterações',MISSING_PAIR:'Par incompleto',DUPLICATE:'Duplicados — revisar fontes'};
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const validCount=value=>Number.isSafeInteger(value)&&value>=0&&value<=MAX_COUNT;
const countLabel=value=>validCount(value)?value.toLocaleString('pt-BR'):'Não informado';
const hasField=field=>Object.hasOwn(FIELD_LABELS,field);
let mountSequence=0;

function monthLabel(period) {
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))return 'Competência inválida';
 return new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${period}-01T12:00:00Z`));
}

function verifiedDriveSource(sources,kind) {
 if(!Array.isArray(sources))return null;
 for(const source of sources){
  if(source?.kind!==kind||typeof source.id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(source.id)||typeof source.url!=='string')continue;
  const canonical=`https://drive.google.com/file/d/${source.id}/view`;
  try {if(new URL(source.url).href===canonical)return canonical;}catch{/* Invalid links are not shown. */}
 }
 return null;
}

function friendlyError(error) {
 const code=String(error?.code||error?.message||'');
 if(/SESSION|AUTH|PERMISSION|UNAUTHORIZED|FORBIDDEN/.test(code))return 'A sessão ou a permissão mudou. Reabra a entrada por prints para continuar.';
 if(/VERSION|CONCURRENT|STALE|BASE_CONFLICT/.test(code))return 'Os dados deste mês foram alterados. Gere uma nova prévia antes de confirmar.';
 if(/EXPIRED/.test(code))return 'Esta prévia expirou. Gere uma nova prévia para continuar.';
 if(/CLOSED/.test(code))return 'Esta competência está encerrada. Consulte a gestão para continuar.';
 if(/MISSING_PAIR/.test(code))return 'Falta uma das imagens deste mês. Complete o par e gere uma nova prévia.';
 if(/DUPLICATE/.test(code))return 'Há fontes duplicadas neste mês. Revise os arquivos no Drive antes de continuar.';
 if(/OCR|AMBIGUOUS|TOTAL_MISSING|TOTAL_MISMATCH|ROW_|TECHNIQUE_UNKNOWN/.test(code))return 'Não foi possível ler os prints com segurança. Confira as imagens e os totais ou use a entrada manual.';
 return 'Não foi possível concluir a operação. Suas imagens e correções foram preservadas. Tente novamente.';
}

/** Mount only the contents of the existing QMENTUM modal body. */
export function mountQmentumPrintInput(host,{unitId,period,client,isCurrent=()=>true,onSaved=()=>{},mode='UPLOAD'}={}) {
 if(!host?.ownerDocument||!client?.scan||!client?.preview||!client?.apply)throw Error('QMENTUM_PRINT_UI_CONFIG_REQUIRED');
 const scope=Object.freeze({unitId,period:String(period??''),year:Number(String(period??'').slice(0,4))});
 const validScope=typeof scope.unitId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(scope.unitId)&&/^\d{4}-(0[1-9]|1[0-2])$/.test(scope.period)&&scope.period>='2026-07'&&scope.period<='2200-12';
 const prefix=`qm-print-${++mountSequence}`;
 const state={disposed:false,busy:false,confirmed:false,mode:mode==='DRIVE'?'DRIVE':'UPLOAD',files:{},urls:{},preview:null,corrections:{},resolutions:{}};
 const current=()=>{try{return !state.disposed&&isCurrent()===true;}catch{return false;}};
 host.innerHTML=`<section class="qm-print" data-print-root aria-busy="false" aria-label="Entrada mensal por prints">
  <header class="qm-print__scope" data-print-scope><strong>${escape(monthLabel(scope.period))}</strong><small>Unidade: ${escape(scope.unitId)} · Competência ${escape(scope.period)}</small></header>
  <p class="qm-print__intro">Confira os dados dos dois prints e confirme a importação para esta competência.</p>
  <div class="qm-print__modes" role="group" aria-label="Origem dos prints"><button type="button" data-print-mode="UPLOAD">Selecionar imagens</button><button type="button" data-print-mode="DRIVE">Usar Drive</button></div>
  <section class="qm-print__upload" data-print-upload aria-label="Imagens da competência">
   <div class="qm-print__files">${KINDS.map(kind=>`<label class="qm-print__file" for="${prefix}-${kind}"><strong>${kind==='TECHNIQUES'?'Tabela de técnicas':'Painel de indicadores'}</strong><small>${kind==='TECHNIQUES'?'Inclua o Total geral.':'Inclua o Total de registros.'} PNG ou JPEG, até 2 MB.</small><input id="${prefix}-${kind}" type="file" accept="image/png,image/jpeg" data-print-file="${kind}"><span data-print-file-info="${kind}">Nenhuma imagem selecionada</span><span class="qm-print__thumbnail" data-print-thumbnail="${kind}"></span></label>`).join('')}</div>
   <button type="button" class="qm-print__primary" data-print-action="upload-preview">Gerar prévia</button>
  </section>
  <section class="qm-print__drive" data-print-drive aria-label="Fontes do Drive"><p>Verifique fontes novas ou alteradas em ${escape(scope.year)}. A prévia será aberta apenas para ${escape(scope.period)}.</p><button type="button" data-print-action="scan">Sincronizar alterações</button><div data-print-candidates></div></section>
  <p class="qm-print__status" data-print-status role="status" aria-live="polite"></p>
  <div data-print-preview></div>
 </section>`;
 const root=host.querySelector('[data-print-root]');
 const status=root.querySelector('[data-print-status]');
 const previewHost=root.querySelector('[data-print-preview]');
 const setStatus=(text,error=false)=>{if(state.disposed)return;status.textContent=text;status.dataset.state=error?'error':'info';};
 const revoke=kind=>{if(state.urls[kind]){URL.revokeObjectURL(state.urls[kind]);delete state.urls[kind];}};
 const conflicts=()=>state.preview?.conflicts||[];
 const conflictFor=field=>conflicts().find(conflict=>conflict.field===field);
 const numericValue=field=>{
  const conflict=conflictFor(field);
  // Validate the incoming totals even when KEEP_MANUAL preserves a missing
  // existing value. Resolution choices never manufacture a current count.
  if(conflict)return conflict.source;
  if(Object.hasOwn(state.corrections,field))return state.corrections[field];
  return state.preview?.counts[field]??null;
 };
 const canApply=()=>{
  if(!state.preview||state.confirmed||!validScope||!current())return false;
  if(conflicts().some(conflict=>!['KEEP_MANUAL','USE_SOURCE'].includes(state.resolutions[conflict.field])))return false;
  if(TOTALS.some(field=>!validCount(numericValue(field))))return false;
  return [...previewHost.querySelectorAll('[data-print-count]')].every(input=>conflictFor(input.dataset.printCount)||validCount(numericValue(input.dataset.printCount)));
 };
 const syncControls=()=>{
  if(state.disposed)return;
  const inactive=!current()||!validScope||state.confirmed;
  root.setAttribute('aria-busy',String(state.busy));
  root.querySelector('[data-print-upload]').hidden=state.mode!=='UPLOAD';
  root.querySelector('[data-print-drive]').hidden=state.mode!=='DRIVE';
  root.querySelectorAll('[data-print-mode]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.printMode===state.mode));});
  root.querySelectorAll('button,input').forEach(control=>{control.disabled=state.busy||inactive;});
  root.querySelector('[data-print-action="upload-preview"]').disabled=state.busy||inactive||KINDS.some(kind=>!state.files[kind]);
  previewHost.querySelectorAll('[data-print-count]').forEach(input=>{
   const field=input.dataset.printCount;
   input.disabled=state.busy||inactive||Boolean(conflictFor(field));
   input.setAttribute('aria-invalid',String(!validCount(numericValue(field))));
   const pending=input.parentElement.querySelector('[data-print-field-pending]');
   if(pending)pending.hidden=validCount(numericValue(field));
  });
  const confirm=root.querySelector('[data-print-action="apply"]');
  if(confirm)confirm.disabled=state.busy||!canApply();
 };
 const ensureCurrent=()=>{
  if(current())return true;
  setStatus('A sessão mudou. Reabra a entrada por prints para continuar.',true);syncControls();return false;
 };
 const run=async(message,operation)=>{
  if(state.busy||state.confirmed||!validScope||!ensureCurrent())return;
  state.busy=true;setStatus(message);syncControls();
  try {await operation();}
  catch(error){if(current())setStatus(friendlyError(error),true);}
  finally {state.busy=false;if(!state.disposed){if(!current())setStatus('A sessão mudou. Reabra a entrada por prints para continuar.',true);syncControls();}}
 };
 const clearPreview=()=>{state.preview=null;state.corrections={};state.resolutions={};state.confirmed=false;previewHost.replaceChildren();};
 const fieldInput=field=>{
  const value=numericValue(field),total=TOTALS.includes(field),label=FIELD_LABELS[field];
  const source=total?verifiedDriveSource(state.preview.sources,field==='anestheticProcedures'?'TECHNIQUES':'INDICATORS'):null;
  return `<label class="qm-print__count${total?' qm-print__count--total':''}" ${total?`data-print-total="${field}"`:''} for="${prefix}-count-${field}"><span>${escape(label)}</span>${total?`<small>${field==='anestheticProcedures'?'Total geral da tabela de técnicas':'Total de registros do painel de indicadores'}</small>`:''}<input id="${prefix}-count-${field}" data-print-count="${field}" type="number" inputmode="numeric" min="0" max="${MAX_COUNT}" step="1" value="${validCount(value)?value:''}">${!validCount(value)?'<small data-print-field-pending>Pendente — informe um número inteiro, inclusive zero.</small>':''}${conflictFor(field)?'<small>Valor da fonte. Selecione abaixo qual valor preservar.</small>':''}${source?`<a data-print-source-link href="${escape(source)}" target="_blank" rel="noopener noreferrer">Conferir ${field==='anestheticProcedures'?'tabela de técnicas':'painel de indicadores'} no Drive</a>`:''}</label>`;
 };
 const renderPreview=()=>{
  const p=state.preview;
  const fields=Object.keys(p.counts).filter(field=>!TOTALS.includes(field)&&p.counts[field]!==null);
  const missing=[...new Set([...p.missingFields,...Object.entries(p.counts).filter(([,value])=>value===null).map(([field])=>field)])].filter(field=>hasField(field)&&!TOTALS.includes(field));
  previewHost.innerHTML=`<section class="qm-print__preview" aria-label="Prévia da importação"><header><h4>Confira a prévia de ${escape(monthLabel(scope.period))}</h4><p>${escape(p.sourceLabel||'Prints da competência')}</p></header><p class="qm-print__notice">Os totais são independentes. Procedimentos anestésicos vêm do <strong>Total geral</strong>; procedimentos cirúrgicos vêm do <strong>Total de registros</strong>. Não some as técnicas para obter o total.</p><div class="qm-print__counts qm-print__totals">${TOTALS.map(fieldInput).join('')}</div><div class="qm-print__counts">${fields.map(fieldInput).join('')}</div>${missing.length?`<section class="qm-print__pending" data-print-missing><h5>Campos não fornecidos — pendentes</h5><p>Os dados existentes destes campos serão preservados; a ausência não vale zero.</p><ul>${missing.map(field=>`<li>${escape(FIELD_LABELS[field])}</li>`).join('')}</ul></section>`:''}${p.changes.length?`<section data-print-changes><h5>Alterações propostas</h5><ul>${p.changes.map(change=>`<li><strong>${escape(FIELD_LABELS[change.field])}</strong>: ${escape(countLabel(change.current??change.from))} → ${escape(countLabel(change.source??change.value??change.to))}</li>`).join('')}</ul></section>`:''}${p.conflicts.length?`<section data-print-conflicts><h5>Escolha como resolver cada conflito</h5>${p.conflicts.map(conflict=>`<fieldset class="qm-print__conflict"><legend>${escape(FIELD_LABELS[conflict.field])}</legend><p>Atual: <strong>${escape(countLabel(conflict.current))}</strong> · Fonte: <strong>${escape(countLabel(conflict.source))}</strong> · Base anterior: ${escape(countLabel(conflict.baseline??conflict.baselineSource))}</p><label><input type="radio" name="${prefix}-conflict-${conflict.field}" data-print-resolution="${conflict.field}" value="KEEP_MANUAL">Manter valor manual: ${escape(countLabel(conflict.current))}</label><label><input type="radio" name="${prefix}-conflict-${conflict.field}" data-print-resolution="${conflict.field}" value="USE_SOURCE">Usar valor da fonte: ${escape(countLabel(conflict.source))}</label></fieldset>`).join('')}</section>`:''}<p class="qm-print__validation">Confirme os dois totais como números inteiros e resolva todos os conflitos antes de importar.</p><button type="button" class="qm-print__primary" data-print-action="apply">Confirmar importação</button></section>`;
  syncControls();
 };
 const acceptPreview=response=>{
  if(response?.status==='UNCHANGED'){clearPreview();setStatus('Sem alterações nas fontes desta competência. Nenhuma importação necessária.');return;}
  const p=response?.preview;
  if(response?.status!=='PREVIEW'||!p||!/^[a-f0-9]{64}$/.test(p.id)||p.period!==scope.period||!Number.isSafeInteger(p.baseVersion)||p.baseVersion<0||!p.counts||Array.isArray(p.counts)||Object.keys(p.counts).some(field=>!hasField(field))||!Array.isArray(p.missingFields)||!Array.isArray(p.changes)||!Array.isArray(p.conflicts)||p.changes.some(change=>!hasField(change?.field))||p.conflicts.some(conflict=>!hasField(conflict?.field))||new Set(p.conflicts.map(conflict=>conflict.field)).size!==p.conflicts.length)throw Error('QMENTUM_PRINT_PREVIEW_INVALID');
  state.preview=structuredClone(p);state.corrections={};state.resolutions={};state.confirmed=false;
  renderPreview();setStatus('Prévia pronta. Revise os valores antes de confirmar.');
 };
 const fileBase64=file=>new Promise((resolve,reject)=>{
  const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('QMENTUM_PRINT_FILE_READ_FAILED'));reader.onabort=()=>reject(Error('QMENTUM_PRINT_FILE_READ_FAILED'));reader.readAsDataURL(file);
 });
 const preview=source=>run('Preparando prévia…',async()=>{
  const payload={unitId:scope.unitId,period:scope.period,source};
  if(source==='UPLOAD'){
   const selected=KINDS.map(kind=>({kind,file:state.files[kind]}));
   if(selected.some(item=>!item.file))return;
   payload.files=[];
   for(const {kind,file} of selected){const base64=await fileBase64(file);if(!ensureCurrent())return;payload.files.push({kind,name:file.name,mimeType:file.type,base64});}
  }
  if(!ensureCurrent())return;
  const response=await client.preview(payload);if(!ensureCurrent())return;acceptPreview(response);
 });
 const scan=()=>run('Verificando fontes do Drive…',async()=>{
  if(!ensureCurrent())return;
  const response=await client.scan({unitId:scope.unitId,year:scope.year});if(!ensureCurrent())return;
  if(!Array.isArray(response?.candidates)||response.candidates.length>12||response.candidates.some(candidate=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(candidate?.period)||Number(candidate.period.slice(0,4))!==scope.year||!Object.hasOwn(CANDIDATE_LABELS,candidate.status)))throw Error('QMENTUM_PRINT_SCAN_INVALID');
  const candidates=response.candidates.filter(candidate=>candidate.period>='2026-07');
  root.querySelector('[data-print-candidates]').innerHTML=candidates.length?`<ul class="qm-print__candidates">${candidates.map(candidate=>`<li data-print-candidate="${candidate.period}"><div><strong>${escape(monthLabel(candidate.period))}</strong><small>${escape(CANDIDATE_LABELS[candidate.status])}${candidate.period===scope.period?' · Competência selecionada':''}</small></div>${candidate.period===scope.period&&['NEW','CHANGED'].includes(candidate.status)?'<button type="button" data-print-action="drive-preview">Revisar este mês</button>':''}</li>`).join('')}</ul>`:'<p>Nenhuma fonte disponível neste ano.</p>';
  setStatus('Verificação concluída. Revise as fontes da competência selecionada antes de importar.');
 });
 const apply=()=>{
  if(state.busy||!ensureCurrent()||!canApply())return;
  return run('Confirmando importação…',async()=>{
   const p=state.preview;
   const corrections=Object.fromEntries(Object.entries(state.corrections).filter(([field,value])=>!conflictFor(field)&&value!==p.counts[field]));
   const payload={unitId:scope.unitId,period:scope.period,previewId:p.id,baseVersion:p.baseVersion,corrections,resolutions:{...state.resolutions}};
   if(!ensureCurrent())return;
   const receipt=await client.apply(payload);if(!ensureCurrent())return;
   if(!['CONFIRMED','UNCHANGED'].includes(receipt?.status)||!Number.isSafeInteger(receipt.version)||receipt.version<0)throw Error('QMENTUM_PRINT_RECEIPT_INVALID');
   state.confirmed=true;setStatus(receipt.status==='CONFIRMED'?'Importação confirmada e salva no FC.':'Importação confirmada. Os dados já estavam atualizados.');syncControls();
   onSaved(receipt);
  });
 };
 const click=event=>{
  const button=event.target.closest('button');if(!button||!root.contains(button)||button.disabled||state.busy)return;
  if(button.dataset.printMode){if(!ensureCurrent())return;state.mode=button.dataset.printMode;syncControls();return;}
  const action=button.dataset.printAction;
  if(action==='upload-preview')void preview('UPLOAD');
  else if(action==='drive-preview')void preview('DRIVE');
  else if(action==='scan')void scan();
  else if(action==='apply')void apply();
 };
 const change=event=>{
  const input=event.target;
  if(state.busy||state.disposed)return;
  if(input.matches('[data-print-file]')){
   if(!ensureCurrent())return;
   const kind=input.dataset.printFile,file=input.files?.[0];
   revoke(kind);delete state.files[kind];clearPreview();
   root.querySelector(`[data-print-thumbnail="${kind}"]`).replaceChildren();
   root.querySelector(`[data-print-file-info="${kind}"]`).textContent='Nenhuma imagem selecionada';
   if(file&&(!['image/png','image/jpeg'].includes(file.type)||file.size>MAX_IMAGE_BYTES||file.size===0)){
    input.value='';setStatus('Selecione uma imagem PNG ou JPEG, de até 2 MB.',true);
   }else if(file){
    state.files[kind]=file;state.urls[kind]=URL.createObjectURL(file);
    const image=host.ownerDocument.createElement('img');image.src=state.urls[kind];image.alt=kind==='TECHNIQUES'?'Prévia da tabela de técnicas selecionada':'Prévia do painel de indicadores selecionado';image.dataset.printImage=kind;
    root.querySelector(`[data-print-thumbnail="${kind}"]`).append(image);
    root.querySelector(`[data-print-file-info="${kind}"]`).textContent=file.name;
    setStatus('Imagens selecionadas. Gere a prévia para revisar os dados.');
   }else setStatus('Selecione os dois prints para gerar a prévia.');
   syncControls();
  }else if(input.matches('[data-print-resolution]')){
   if(!ensureCurrent())return;
   state.resolutions[input.dataset.printResolution]=input.value;
   const count=previewHost.querySelector(`[data-print-count="${input.dataset.printResolution}"]`),value=numericValue(input.dataset.printResolution);
   if(count)count.value=validCount(value)?String(value):'';
   syncControls();
  }
 };
 const edit=event=>{
  const input=event.target;if(state.busy||state.disposed||!input.matches('[data-print-count]')||input.disabled)return;
  if(!ensureCurrent())return;
  state.corrections[input.dataset.printCount]=input.value.trim()===''?null:Number(input.value);syncControls();
 };
 root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',edit);
 if(!validScope)setStatus('A entrada por prints está disponível a partir de julho de 2026. Selecione uma competência válida.',true);
 else if(!current())setStatus('A sessão mudou. Reabra a entrada por prints para continuar.',true);
 else setStatus('Selecione os dois prints ou verifique as fontes do Drive.');
 syncControls();
 return ()=>{
  if(state.disposed)return;state.disposed=true;
  root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('input',edit);
  KINDS.forEach(revoke);state.files={};
  root.querySelectorAll('button,input').forEach(control=>{control.disabled=true;});
 };
}
