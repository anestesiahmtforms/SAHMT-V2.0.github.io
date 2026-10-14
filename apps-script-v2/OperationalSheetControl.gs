/** Private, bidirectional control of the three FA operational registers.
 * No Firebase users, permissions, billing or unrelated collections are changed.
 * Initial empty sheets are NEVER interpreted as deletion instructions.
 */
const OSC = Object.freeze({
  sheetId: '1I4FO9iNIFXot8O2p4GI6St76Qu_pznO8iSdyzt65E64',
  stateTab: '_CONTROLE_SAHMT', enabled: 'SAHMT_OPERATIONAL_SHEETS_ENABLED',
  ready: 'SAHMT_OPERATIONAL_SHEETS_READY', cursor: 'SAHMT_OPERATIONAL_CURSOR_',
  handlers: ['sincronizarRegistrosOperacionaisV1', 'aoEditarRegistrosOperacionaisV1', 'aoExcluirLinhasOperacionaisV1'],
  timezone: 'America/Sao_Paulo', archive: 'operationalSheetArchives',
  tables: [
    {name: 'EVENTOS', collection: 'events', columns: [
      ['date','Data do Evento','date'], ['memberStatus','MEMBRO AUSENTE/ATRASADO'], ['eventType','Tipo de Evento'],
      ['description','Descrição do evento'], ['delayMultiple','Múltiplo do atraso','number'], ['substitute','Substituto'],
      ['shift','Turno'], ['payer','Pagador'], ['creditor','Credor'], ['amountToPay','Valor a pagar','money']]},
    {name: 'ETIQUETAS', collection: 'labels', columns: [
      ['date','Data da leitura','date'], ['patientName','Nome do Paciente'], ['insurance','Convênio'],
      ['encounterCode','Atendimento'], ['procedureCode','Cirurgia'], ['type','Tipo'], ['creditor','Credor'],
      ['amount','Valor em Real · opcional','money'], ['staffSiglas','PLANTONISTAS','list']]},
    {name: 'CHECKLIST', collection: 'checklists', columns: [
      ['date','Data','date'], ['stationId','Arsenal','station'], ['condition','Condição'], ['occurrence','Ocorrência']]}
  ]
});

function oscFail_(code) { const error = new Error(code); error.safeCode = code; throw error; }
function oscOwner_() {
  if (String(Session.getEffectiveUser().getEmail()).toLowerCase() !== 'anestesiahmtforms@gmail.com') oscFail_('CONTROLE_EXECUTOR_INVALIDO');
}
function oscBook_() {
  if (SAHMT_V2_CONFIG.projectId !== 'sahmt-17a16' || sahmtV2SpreadsheetId_() !== OSC.sheetId) oscFail_('CONTROLE_DESTINO_INVALIDO');
  sahmtV2RequirePrivateSpreadsheet_(OSC.sheetId);
  return SpreadsheetApp.openById(OSC.sheetId);
}
function oscLocked_(operation) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) oscFail_('CONTROLE_OCUPADO');
  try { return operation(); } finally { lock.releaseLock(); }
}
function oscResult_(code, values) {
  const result = Object.assign({code: code}, values || {});
  console.log(JSON.stringify(result));
  return result;
}
function oscCanonical_(cells) { return cells.map(function (v) { return v instanceof Date ? v.getTime() : v == null ? '' : typeof v==='string'&&/^'[=+\-@]/.test(v)?v.slice(1):v; }); }
function oscEqual_(a,b) { return JSON.stringify(oscCanonical_(a)) === JSON.stringify(oscCanonical_(b)); }
function oscHeaders_(table) {
  return table.columns.map(function (c) { return c[1]; }).concat(['Registrado por','Registrado em','Atualizado em','Sincronização','Chave técnica','Versão técnica']);
}
function oscSafeText_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
function oscList_(collection) {
  const documents = []; let token = ''; const seen = new Set();
  do {
    const result = firestoreRequest_(firestoreDocumentsUrl_('/' + collection) + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''), {method:'get'});
    documents.push.apply(documents, result.documents || []);
    token = result.nextPageToken || '';
    if (token && seen.has(token)) oscFail_('CONTROLE_PAGINACAO_INVALIDA');
    seen.add(token);
  } while (token);
  return documents;
}
function oscDocKey_(doc) {
  const prefix = 'projects/sahmt-17a16/databases/(default)/documents/';
  if (!doc || !String(doc.name).startsWith(prefix)) oscFail_('CONTROLE_DOCUMENTO_INVALIDO');
  const key = doc.name.slice(prefix.length);
  if (!/^(events|labels|checklists)\/[^/]+$/.test(key)) oscFail_('CONTROLE_RECURSO_INVALIDO');
  return key;
}
function oscCatalog_(book, refresh) {
  const props = sahmtV2Properties_();
  if (!refresh) { const cached = props.getProperty('SAHMT_OPERATIONAL_STATIONS'); if (cached) return JSON.parse(cached); }
  const catalog = {};
  oscList_('stations').forEach(function (doc) {
    const f = firestoreFieldsToJs_(doc.fields); catalog[doc.name.split('/').pop()] = f.name || doc.name.split('/').pop();
  });
  props.setProperty('SAHMT_OPERATIONAL_STATIONS', JSON.stringify(catalog));
  return catalog;
}
function oscRow_(table, doc, catalog) {
  const f = firestoreFieldsToJs_(doc.fields), key = oscDocKey_(doc);
  const row = table.columns.map(function (c) {
    let v = f[c[0]];
    if (c[2] === 'date') return v ? Utilities.parseDate(String(v), OSC.timezone, 'yyyy-MM-dd') : '';
    if (c[2] === 'station') return oscSafeText_(catalog[v] || v);
    if (c[2] === 'list') return oscSafeText_((v || []).join(', '));
    if (c[2] === 'money' || c[2] === 'number') return typeof v === 'number' ? v : '';
    if (c[0] === 'condition' && v === 'NAO') return 'NÃO';
    return oscSafeText_(v);
  });
  return row.concat([oscSafeText_(f.createdByName || ''), f.createdAt instanceof Date ? f.createdAt : '',
    f.updatedAt instanceof Date ? f.updatedAt : '', 'Sincronizado', key, Number(f.version) || 1]);
}
function oscTable_(collection) { const table = OSC.tables.find(function (t) { return t.collection === collection; }); if (!table) oscFail_('CONTROLE_RECURSO_INVALIDO'); return table; }
function oscState_(book) {
  const sheet = book.getSheetByName(OSC.stateTab);
  if (!sheet) oscFail_('CONTROLE_CARGA_INICIAL_AUSENTE');
  const result = new Map();
  if (sheet.getLastRow() > 1) sheet.getRange(2,1,sheet.getLastRow()-1,2).getValues().forEach(function (row) {
    if (!row[0]) return;
    if (result.has(row[0])) oscFail_('CONTROLE_CHAVE_DUPLICADA');
    result.set(row[0], JSON.parse(row[1]));
  });
  return result;
}
function oscSaveState_(book, state) {
  const sheet = book.getSheetByName(OSC.stateTab), rows = [];
  state.forEach(function (value,key) { rows.push([key,JSON.stringify(value)]); });
  if (rows.length + 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
  if (rows.length) sheet.getRange(2,1,rows.length,2).setValues(rows);
  if (sheet.getLastRow() > rows.length+1) sheet.getRange(rows.length+2,1,sheet.getLastRow()-rows.length-1,2).clearContent();
  SpreadsheetApp.flush();
}
function oscRows_(book, table) {
  const sheet = book.getSheetByName(table.name), headers = oscHeaders_(table);
  if (!sheet || !oscEqual_(sheet.getRange(1,1,1,headers.length).getValues()[0],headers)) oscFail_('CONTROLE_CABECALHO_ALTERADO');
  const rows = new Map();
  if (sheet.getLastRow() > 1) sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).getValues().forEach(function (cells,i) {
    if (cells.every(function(v) {return v === '';})) return;
    const key = String(cells[headers.length-2]);
    if (!key.startsWith(table.collection+'/') || rows.has(key)) oscFail_('CONTROLE_CHAVE_ALTERADA_OU_DUPLICADA');
    rows.set(key,{number:i+2,cells:cells});
  });
  return {sheet:sheet,rows:rows};
}
function oscFormat_(sheet, table) {
  const n = oscHeaders_(table).length;
  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,n).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0d3257').setWrap(true);
  sheet.setRowHeight(1,48);
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getRange(1,1,sheet.getMaxRows(),n).createFilter();
  table.columns.forEach(function (c,i) {
    const format = c[2] === 'date' ? 'dd/MM/yyyy' : c[2] === 'money' ? '"R$" #,##0.00' : c[2] === 'number' ? '0' : '@';
    sheet.getRange(2,i+1,sheet.getMaxRows()-1,1).setNumberFormat(format);
    sheet.setColumnWidth(i+1,['description','occurrence','patientName','memberStatus'].indexOf(c[0]) >= 0 ? 260 : 165);
  });
  sheet.getRange(2,table.columns.length+2,sheet.getMaxRows()-1,2).setNumberFormat('dd/MM/yyyy HH:mm');
  sheet.setColumnWidths(table.columns.length+1,4,185);
  // Only fields entered in the PWA remain visible. Audit and sync metadata is hidden.
  sheet.hideColumns(table.columns.length+1,n-table.columns.length);
  sheet.getRange(2,1,Math.max(1,sheet.getLastRow()-1),n-2).setVerticalAlignment('middle').setWrap(true);
  sheet.getRange(1,n-1,1,2).setNotes([['Não alterar: vínculo único com o Firestore.','Não alterar: controle de concorrência.']]);
}
function oscBackup_(book, documents) {
  const folder = sahmtV2RequirePrivateFolder_();
  const file = folder.createFile('SAHMT-copia-registros-' + Utilities.formatDate(new Date(),OSC.timezone,'yyyyMMdd-HHmmss')+'.json',
    JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),documents:documents}),MimeType.PLAIN_TEXT);
  if (file.getSharingAccess() !== DriveApp.Access.PRIVATE) oscFail_('CONTROLE_COPIA_NAO_PRIVADA');
  sahmtV2Properties_().setProperty('SAHMT_OPERATIONAL_BACKUP_ID',file.getId());
}

/** Read-only against Firestore. Installs the full historical baseline before enabling writes. */
function prepararControleOperacionalV1() {
  oscOwner_();
  return oscLocked_(function () {
    const props = sahmtV2Properties_(), book = oscBook_();
    if (props.getProperty(OSC.ready) === 'YES') return oscResult_('CONTROLE_JA_PREPARADO');
    // Every existing register must be empty for the initial layout migration.
    OSC.tables.forEach(function(t) { const s=book.getSheetByName(t.name); if(s && s.getLastRow()>1) oscFail_('CONTROLE_ABA_JA_PREENCHIDA'); });
    const started = new Date().toISOString(), catalog = oscCatalog_(book,true), records = {}, all = [];
    OSC.tables.forEach(function(t) { records[t.collection]=oscList_(t.collection); all.push.apply(all,records[t.collection]); });
    oscBackup_(book,all);
    const state = new Map(), counts = {};
    let ledger = book.getSheetByName(OSC.stateTab) || book.insertSheet(OSC.stateTab);
    ledger.getRange(1,1,1,2).setValues([['Chave interna','Estado de sincronização']]);
    OSC.tables.forEach(function(t) {
      const sheet=book.getSheetByName(t.name)||book.insertSheet(t.name), rows=[];
      records[t.collection].forEach(function(doc) {
        const f=firestoreFieldsToJs_(doc.fields), key=oscDocKey_(doc);
        if (f.sheetDeleted === true || f.active === false) return;
        const cells=oscRow_(t,doc,catalog);
        rows.push(cells); state.set(key,{updateTime:doc.updateTime,cells:oscCanonical_(cells),deleted:false});
      });
      const width=oscHeaders_(t).length;
      if (width>sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(),width-sheet.getMaxColumns());
      if (rows.length+1>sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(),rows.length+1-sheet.getMaxRows());
      sheet.getDataRange().clearContent();
      sheet.getRange(1,1,1,width).setValues([oscHeaders_(t)]);
      // Format before writing to preserve zero-prefixed identifiers and real date cells.
      oscFormat_(sheet,t);
      if(rows.length) sheet.getRange(2,1,rows.length,width).setValues(rows);
      counts[t.name]=rows.length;
    });
    oscSaveState_(book,state);
    const protection=ledger.protect().setDescription('SAHMT: não editar o controle interno').setWarningOnly(false);
    const editors=protection.getEditors().filter(function(u){return u.getEmail()!=='anestesiahmtforms@gmail.com';});
    if(editors.length)protection.removeEditors(editors);
    if(protection.canDomainEdit())protection.setDomainEdit(false);
    ledger.hideSheet();
    oscSummary_(book,state);
    oscTranslateLegacyHeaders_(book);
    OSC.tables.forEach(function(t) { props.setProperty(OSC.cursor+t.collection,JSON.stringify({timestamp:started})); });
    props.setProperty(OSC.ready,'YES'); props.setProperty(OSC.enabled,'NO');
    return oscResult_('CONTROLE_CARGA_INICIAL_CONCLUIDA', {counts:counts,firestoreWrites:0});
  });
}

function ativarControleOperacionalV1() {
  oscOwner_();
  return oscLocked_(function() {
    const props=sahmtV2Properties_(), book=oscBook_();
    if(props.getProperty(OSC.ready)!=='YES') oscFail_('CONTROLE_CARGA_INICIAL_AUSENTE');
    const state=oscState_(book);
    OSC.tables.forEach(function(t) { const current=oscRows_(book,t); state.forEach(function(s,key) {
      if(key.startsWith(t.collection+'/')&&!s.deleted&&!current.rows.has(key)) oscFail_('CONTROLE_LINHAS_AUSENTES');
    }); });
    props.setProperty(OSC.enabled,'NO');
    ScriptApp.getProjectTriggers().forEach(function(t) { if(OSC.handlers.indexOf(t.getHandlerFunction())>=0) ScriptApp.deleteTrigger(t); });
    try {
      const triggers=[ScriptApp.newTrigger(OSC.handlers[1]).forSpreadsheet(book).onEdit().create(),
        ScriptApp.newTrigger(OSC.handlers[2]).forSpreadsheet(book).onChange().create()];
      props.setProperty('SAHMT_OPERATIONAL_TRIGGER_IDS',JSON.stringify(triggers.map(function(t){return t.getUniqueId();})));
      props.setProperty(OSC.enabled,'YES');
    } catch (_) { oscFail_('CONTROLE_GATILHOS_NAO_INSTALADOS'); }
    return oscResult_('CONTROLE_EDICOES_PLANILHA_ATIVO',{periodicReads:false,operationalTables:3});
  });
}
/** Initial baseline plus spreadsheet edit/change triggers. Never installs polling. */
function instalarControleOperacionalCompletoV1() {
  oscOwner_();
  const prepared=prepararControleOperacionalV1();
  if(!prepared || !['CONTROLE_CARGA_INICIAL_CONCLUIDA','CONTROLE_JA_PREPARADO'].includes(prepared.code)) {
    oscFail_('CONTROLE_CARGA_INICIAL_NAO_CONFIRMADA');
  }
  const active=ativarControleOperacionalV1();
  return oscResult_('CONTROLE_COMPLETO_INSTALADO',{preparation:prepared.code,activation:active.code,counts:prepared.counts||null});
}
function desativarControleOperacionalV1() {
  oscOwner_(); sahmtV2Properties_().setProperty(OSC.enabled,'NO');
  ScriptApp.getProjectTriggers().forEach(function(t) { if(OSC.handlers.indexOf(t.getHandlerFunction())>=0) ScriptApp.deleteTrigger(t); });
  return oscResult_('CONTROLE_DESATIVADO_DADOS_PRESERVADOS');
}

function oscTrigger_(event) {
  const p=sahmtV2Properties_();
  return p.getProperty(OSC.enabled)==='YES' && event && event.source && event.source.getId()===OSC.sheetId &&
    JSON.parse(p.getProperty('SAHMT_OPERATIONAL_TRIGGER_IDS')||'[]').indexOf(String(event.triggerUid))>=0;
}
function aoEditarRegistrosOperacionaisV1(event) {
  if (!oscTrigger_(event) || !event.range || !OSC.tables.some(function(t){return t.name===event.range.getSheet().getName();})) return;
  const table=OSC.tables.find(function(t){return t.name===event.range.getSheet().getName();});
  if(event.range.getRow()===1 || event.range.getLastColumn()>table.columns.length) {
    sahmtV2Properties_().setProperty(OSC.enabled,'NO');
    oscFail_('CONTROLE_PAUSADO_EDICAO_COLUNA_TECNICA');
  }
  return oscRun_('EDIT',event);
}
function aoExcluirLinhasOperacionaisV1(event) {
  if (!oscTrigger_(event) || event.changeType!=='REMOVE_ROW') return;
  return oscRun_('REMOVE_ROW',event);
}
/** Kept for existing installed triggers: the next invocation removes polling BEFORE any database read. */
function sincronizarRegistrosOperacionaisV1() { return cancelarIntervalosPlanilhaV1(); }
function cancelarIntervalosPlanilhaV1() {
  oscOwner_();
  let removed=0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if(['sincronizarRegistrosOperacionaisV1','syncSparkReportsPeriodically'].includes(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger); removed++;
    }
  });
  return oscResult_('CONTROLE_INTERVALOS_CANCELADOS',{removed:removed,firestoreReads:0});
}
/** Explicit recovery only; never registered as a time trigger. */
function recuperarRegistrosPlanilhaManualmenteV1() { oscOwner_(); return oscRun_('PULL',null); }

function oscParseDate_(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return Utilities.formatDate(value,OSC.timezone,'yyyy-MM-dd');
  let text=String(value).trim();
  const br=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text); if(br) text=br[3]+'-'+br[2]+'-'+br[1];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text+'T12:00:00Z')) || new Date(text+'T12:00:00Z').toISOString().slice(0,10)!==text) oscFail_('CONTROLE_DATA_INVALIDA');
  return text;
}
function oscEditedFields_(table,cells,baseline,catalog) {
  const changes={}, count=table.columns.length, normalized=oscCanonical_(cells);
  // No privilege, author, key, version, timestamps or status edits are accepted from cells.
  for(let i=count;i<cells.length;i++) if(i!==count+3 && normalized[i]!==baseline.cells[i]) oscFail_('CONTROLE_COLUNA_TECNICA_ALTERADA');
  table.columns.forEach(function(c,i) {
    if(normalized[i]===baseline.cells[i]) return;
    let v=cells[i];
    if(c[2]==='date') v=oscParseDate_(v);
    else if(c[2]==='money'||c[2]==='number') {
      if(v===''&&c[0]==='amount') v=null;
      else if(typeof v!=='number'||!Number.isFinite(v)||v<0) oscFail_('CONTROLE_VALOR_INVALIDO');
    } else if(c[2]==='station') {
      const matches=Object.keys(catalog).filter(function(id){return catalog[id]===String(v);});
      if(matches.length!==1) oscFail_('CONTROLE_ARSENAL_INVALIDO'); v=matches[0];
    } else if(c[2]==='list') v=String(v).split(',').map(function(x){return x.trim().toUpperCase();}).filter(Boolean);
    else {v=String(v).trim(); if(/^[=+@]/.test(v)) oscFail_('CONTROLE_FORMULA_NAO_PERMITIDA');}
    if(typeof v==='string'&&v.length>2000) oscFail_('CONTROLE_TEXTO_MUITO_LONGO');
    if(c[0]==='condition') v=v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
    changes[c[0]]=v;
  });
  return changes;
}
function oscValidate_(table,fields) {
  oscParseDate_(fields.date);
  if(table.collection==='checklists') {
    if(['SIM','NAO'].indexOf(fields.condition)<0 || !fields.stationId) oscFail_('CONTROLE_CONDICAO_INVALIDA');
    if(fields.condition==='NAO'&&!String(fields.occurrence||'').trim()) oscFail_('CONTROLE_OCORRENCIA_OBRIGATORIA');
    fields.status=fields.condition==='SIM'?'COMPLETED':'MAINTENANCE';
    if(fields.condition==='SIM') fields.occurrence='';
  } else if(table.collection==='labels') {
    if(['Particular','Complementação','Convênio','Consulta Pré-anestésica','SADT'].indexOf(fields.type)<0 ||
      ['Caixa','Plantão','Plantão/Caixa'].indexOf(fields.creditor)<0 || !fields.patientName || String(fields.patientName).length>160 || !fields.encounterCode) oscFail_('CONTROLE_ETIQUETA_INVALIDA');
    if(fields.amount!=null&&(!Number.isFinite(fields.amount)||fields.amount<0)) oscFail_('CONTROLE_VALOR_INVALIDO');
    if(!Array.isArray(fields.staffSiglas)||fields.staffSiglas.length>20 || new Set(fields.staffSiglas).size!==fields.staffSiglas.length ||
      (fields.creditor==='Caixa'?fields.staffSiglas.length!==0:fields.staffSiglas.length===0)) oscFail_('CONTROLE_PLANTONISTAS_INVALIDOS');
    fields.consultation=fields.type==='Consulta Pré-anestésica';
  } else {
    const type=String(fields.eventType||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
    if(['pessoal','ferias','atraso','suporte','gestao','congresso','saude','ausencia','outros'].indexOf(type)<0 ||
      (type!=='suporte'&&!fields.memberStatus)||!fields.payer||!fields.creditor) oscFail_('CONTROLE_EVENTO_INVALIDO');
    if(type==='outros'&&!fields.description) oscFail_('CONTROLE_DESCRICAO_OBRIGATORIA');
    if(['atraso','outros'].indexOf(type)>=0 && (!Number.isInteger(fields.delayMultiple)||fields.delayMultiple<0||fields.delayMultiple>6)) oscFail_('CONTROLE_ATRASO_INVALIDO');
    if(type!=='atraso'&&(!fields.substitute||!fields.shift)) oscFail_('CONTROLE_SUBSTITUTO_TURNO_OBRIGATORIOS');
    if(!Number.isFinite(fields.amountToPay)||fields.amountToPay<0) oscFail_('CONTROLE_VALOR_INVALIDO');
  }
  return fields;
}
function oscGet_(key) {
  try { return firestoreRequest_(firestoreDocumentsUrl_('/'+key),{method:'get'}); }
  catch(error) { if(error.status===404)return null; throw error; }
}
function oscFullName_(key) { return 'projects/sahmt-17a16/databases/(default)/documents/'+key; }
function oscPlanMutation_(table,current,baseline,changes,remove,archiveId,now) {
  const key=oscDocKey_(current);
  if(current.updateTime!==baseline.updateTime) oscFail_('CONTROLE_CONFLITO_COM_APP');
  const before=firestoreFieldsToJs_(current.fields);
  if(before.sheetDeleted || before.active===false) oscFail_('CONTROLE_REGISTRO_JA_REMOVIDO');
  const after=remove?{id:key.split('/')[1],active:false,sheetDeleted:true,sheetArchiveId:archiveId,
    deletedAt:now,updatedAt:now,version:(Number(before.version)||1)+1}:
    oscValidate_(table,Object.assign({},before,changes,{updatedAt:now,version:(Number(before.version)||1)+1,lastEditSource:'PLANILHA'}));
  // A tombstone omits date/createdAt/stationId, so existing report queries exclude it.
  // The ID remains occupied, preventing delayed offline creates from resurrecting it.
  const archive={sourceKey:key,sourceUpdateTime:current.updateTime,action:remove?'EXCLUSAO':'EDICAO',
    snapshotJson:JSON.stringify(current),createdAt:now,source:'PLANILHA',actor:'EDITOR_DA_PLANILHA'};
  return {before:before,after:after,writes:[
    {update:{name:oscFullName_(OSC.archive+'/'+archiveId),fields:firestoreFieldsFromJs_(archive)},currentDocument:{exists:false}},
    {update:{name:current.name,fields:firestoreFieldsFromJs_(after)},currentDocument:{updateTime:current.updateTime}}
  ]};
}
function oscScheduleWrites_(key,before,after,now) {
  if(!key.startsWith('events/')||!before.scheduleSigla)return [];
  const writes=[], id=key.split('/')[1], dates=Array.from(new Set([before.date,after.sheetDeleted?before.date:after.date]));
  dates.forEach(function(day) {
    const doc=oscGet_('scheduleDays/'+day); if(!doc)return;
    const fields=firestoreFieldsToJs_(doc.fields), previous=(fields.highlights||{}).events||[];
    const events=previous.filter(function(m){return !String(m).endsWith(':'+id);});
    if(!after.sheetDeleted&&day===after.date) events.push('EVENTO:'+String(after.scheduleSigla).toUpperCase()+':'+String(after.memberSigla||'-').toUpperCase()+':'+id);
    if(JSON.stringify(events)===JSON.stringify(previous))return;
    fields.highlights=Object.assign({},fields.highlights,{events:events}); fields.version=(Number(fields.version)||0)+1; fields.updatedAt=now;
    writes.push({update:{name:doc.name,fields:firestoreFieldsFromJs_(fields)},currentDocument:{updateTime:doc.updateTime}});
  });
  return writes;
}
function oscApply_(book,table,key,baseline,changes,remove,stillCurrent) {
  const current=oscGet_(key); if(!current)oscFail_('CONTROLE_REGISTRO_AUSENTE');
  const archiveId=Utilities.getUuid(), now=new Date(), plan=oscPlanMutation_(table,current,baseline,changes,remove,archiveId,now);
  plan.writes.push.apply(plan.writes,oscScheduleWrites_(key,plan.before,plan.after,now));
  if(stillCurrent&&!stillCurrent())oscFail_('CONTROLE_PLANILHA_ALTERADA_DURANTE_ENVIO');
  const response=firestoreRequest_(firestoreDocumentsUrl_(':commit'),{method:'post',contentType:'application/json',payload:JSON.stringify({writes:plan.writes})});
  if(remove)sahmtV2Properties_().setProperty('SAHMT_OPERATIONAL_LAST_DELETION',archiveId);
  return {name:current.name,fields:firestoreFieldsFromJs_(plan.after),updateTime:response.writeResults[1].updateTime};
}
function oscSetRow_(view,table,key,cells) {
  let row=view.rows.get(key);
  if(!row){row={number:view.sheet.getLastRow()+1}; if(row.number>view.sheet.getMaxRows())view.sheet.insertRowsAfter(view.sheet.getMaxRows(),100);}
  view.sheet.getRange(row.number,1,1,cells.length).setValues([cells]); row.cells=cells; view.rows.set(key,row);
}
function oscErrorCode_(error) {
  return error && /^CONTROLE_[A-Z_]+$/.test(error.safeCode||'')?error.safeCode:
    error&&Number.isInteger(error.status)?'CONTROLE_HTTP_'+error.status:'CONTROLE_FALHA_SEGURA';
}
function oscRun_(mode,event) {
  if(sahmtV2Properties_().getProperty(OSC.enabled)!=='YES')return oscResult_('CONTROLE_DESATIVADO');
  return oscLocked_(function() {
    const book=oscBook_(), state=oscState_(book), catalog=oscCatalog_(book,false), views={},result={updated:0,removed:0,received:0,conflicts:0};
    OSC.tables.forEach(function(t){views[t.collection]=oscRows_(book,t);views[t.collection].rows.forEach(function(_,key){if(!state.has(key))oscFail_('CONTROLE_LINHA_SEM_ORIGEM');});});
    // Deletion intent only comes from a real row-removal trigger after a complete baseline.
    if(mode==='REMOVE_ROW') {
      state.forEach(function(s,key){ if(!s.deleted&&!views[key.split('/')[0]].rows.has(key))s.intent='DELETE'; });
      oscSaveState_(book,state);
    }
    state.forEach(function(s,key) {
      if(s.deleted)return;
      const t=oscTable_(key.split('/')[0]), view=views[t.collection], row=view.rows.get(key);
      try {
        if(!row && s.intent!=='DELETE')return; // Missing rows alone cannot authorize deletion.
        const changes=row?oscEditedFields_(t,row.cells,s,catalog):{}, remove=!row&&s.intent==='DELETE';
        if(!remove&&!Object.keys(changes).length){delete s.error;return;}
        if(row && view.sheet.getRange(row.number,1,1,row.cells.length).getFormulas()[0].some(Boolean)) oscFail_('CONTROLE_FORMULA_NAO_PERMITIDA');
        const updated=oscApply_(book,t,key,s,changes,remove,function(){
          const currentRows=oscRows_(book,t).rows,latest=currentRows.get(key);
          return remove?!latest:Boolean(latest&&oscEqual_(latest.cells,row.cells));
        });
        if(remove){s.deleted=true;delete s.intent;s.updateTime=updated.updateTime;result.removed++;}
        else { const cells=oscRow_(t,updated,catalog); oscSetRow_(view,t,key,cells); state.set(key,{updateTime:updated.updateTime,cells:oscCanonical_(cells),deleted:false}); result.updated++; }
        oscSaveState_(book,state);
      } catch(error) {
        result.conflicts++;
        const code=oscErrorCode_(error); s.error=code;
        if(row) view.sheet.getRange(row.number,t.columns.length+4).setValue(code);
      }
    });
    oscSaveState_(book,state);
    if(mode==='PULL')OSC.tables.forEach(function(t) {
      const p=sahmtV2Properties_(), savedCursor=p.getProperty(OSC.cursor+t.collection);
      if(!savedCursor)oscFail_('CONTROLE_CURSOR_AUSENTE');
      const cursor=JSON.parse(savedCursor);
      const query=oscIncrementalQuery_(t,cursor);
      const incoming=firestoreRequest_(firestoreDocumentsUrl_(':runQuery'),{method:'post',contentType:'application/json',payload:JSON.stringify(query)});
      let next=cursor, blocked=false;
      incoming.forEach(function(item) {
        if(!item.document)return;
        const doc=item.document,key=oscDocKey_(doc),old=state.get(key),view=views[t.collection],row=view.rows.get(key),f=firestoreFieldsToJs_(doc.fields);
        const candidate={timestamp:doc.fields.updatedAt.timestampValue,name:doc.name};
        if(old&&old.updateTime===doc.updateTime){next=candidate;return;}
        if(old&&!old.deleted&&(!row||!oscEqual_(row.cells.slice(0,t.columns.length),old.cells.slice(0,t.columns.length)))){blocked=true;return;}
        if(f.sheetDeleted||f.active===false){ if(row){view.sheet.getRange(row.number,1,1,oscHeaders_(t).length).clearContent();view.rows.delete(key);} state.set(key,{updateTime:doc.updateTime,cells:old?old.cells:[],deleted:true}); }
        else {const cells=oscRow_(t,doc,catalog);oscSetRow_(view,t,key,cells);state.set(key,{updateTime:doc.updateTime,cells:oscCanonical_(cells),deleted:false});result.received++;}
        next=candidate;
      });
      oscSaveState_(book,state);
      if(!blocked)p.setProperty(OSC.cursor+t.collection,JSON.stringify(next));
    });
    oscSummary_(book,state);
    const status=book.getSheetByName('Controle da sincronização')||book.insertSheet('Controle da sincronização');
    status.getRange(1,1,5,2).setValues([['CONTROLE DOS LANÇAMENTOS',''],['Última execução',new Date()],['Atualizações na planilha',result.received],['Alterações enviadas ao banco',result.updated+result.removed],['Pendências de revisão',result.conflicts]]);
    status.getRange(2,2).setNumberFormat('dd/MM/yyyy HH:mm');status.setColumnWidths(1,2,290);
    return oscResult_('CONTROLE_SINCRONIZACAO_CONCLUIDA',result);
  });
}
function oscIncrementalQuery_(table,cursor) {
  const structured={from:[{collectionId:table.collection}],orderBy:[{field:{fieldPath:'updatedAt'},direction:'ASCENDING'},{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:200};
  if(cursor.name)structured.startAt={before:false,values:[{timestampValue:cursor.timestamp},{referenceValue:cursor.name}]};
  else structured.where={fieldFilter:{field:{fieldPath:'updatedAt'},op:'GREATER_THAN_OR_EQUAL',value:{timestampValue:cursor.timestamp}}};
  return {structuredQuery:structured};
}
function oscSummary_(book,state) {
  const table=oscTable_('labels'),groups=new Map();
  state.forEach(function(s,key){
    if(!key.startsWith('labels/')||s.deleted)return;
    const row=s.cells,month=Utilities.formatDate(new Date(row[0]),OSC.timezone,'MM/yyyy'),type=row[5],creditor=row[6],consultation=type==='Consulta Pré-anestésica'?'SIM':'NÃO';
    const id=JSON.stringify([month,type,creditor,consultation]);
    const summary=groups.get(id)||[month,type,creditor,0,0,consultation];summary[3]++;summary[4]+=Number(row[7])||0;groups.set(id,summary);
  });
  const sheet=book.getSheetByName('Etiquetas Resumo')||book.insertSheet('Etiquetas Resumo'),rows=Array.from(groups.values());
  sheet.getRange(1,1,1,6).setValues([['Mês','Tipo','Credor','Quantidade de registros','Valor total','Consulta Pré-anestésica']]);
  if(sheet.getLastRow()>1)sheet.getRange(2,1,sheet.getLastRow()-1,6).clearContent();
  if(rows.length){sheet.getRange(2,1,rows.length,1).setNumberFormat('@');sheet.getRange(2,1,rows.length,6).setValues(rows);sheet.getRange(2,5,rows.length,1).setNumberFormat('"R$" #,##0.00');}
  sheet.setFrozenRows(1);sheet.setColumnWidths(1,6,185);sheet.getRange(1,1,1,6).setFontWeight('bold').setWrap(true);sheet.setRowHeight(1,45);
}
function oscTranslateLegacyHeaders_(book) {
  const labels={syncKey:'Chave de sincronização',resourceType:'Tipo de registro',idRegistro:'Identificador do registro',uid:'Identificador do usuário',trainingId:'Identificador do treinamento',title:'Título',description:'Descrição',videoId:'Identificador do vídeo',videoUrl:'Link do vídeo',startedAt:'Iniciado em',lastPosition:'Última posição',duration:'Duração',watchedPercent:'Percentual assistido',status:'Situação',sourceType:'Tipo de origem',completionPoints:'Pontos por conclusão',points:'Pontos',createdAt:'Criado em',updatedAt:'Atualizado em',completedAt:'Concluído em',version:'Versão',managementAreaId:'Área de gestão',activityId:'Identificador da atividade',responsibleUid:'Identificador do responsável',responsibleUids:'Responsáveis',participantUids:'Participantes',priority:'Prioridade',dueAt:'Prazo',createdByUid:'Identificador do autor',updatedByUid:'Identificador do editor',type:'Tipo',pointsGenerated:'Pontos gerados',indicatorId:'Identificador do indicador',name:'Nome',unit:'Unidade',target:'Meta',direction:'Direção',frequency:'Frequência',ownerUid:'Identificador do gestor',period:'Período',value:'Valor',planId:'Identificador do plano',origin:'Origem',openedAt:'Aberto em',sourceId:'Identificador da origem',ruleVersion:'Versão da regra',timestamp:'Data e hora',actorUid:'Identificador do usuário',action:'Ação',resourceId:'Identificador do recurso',requestId:'Identificador da solicitação',deviceId:'Identificador do dispositivo',appVersion:'Versão do aplicativo'};
  Object.keys(SAHMT_V2_REPORT_TABS).forEach(function(name){
    if(OSC.tables.some(function(t){return t.name===name;}))return;
    const sheet=book.getSheetByName(name),fields=SAHMT_V2_REPORT_TABS[name].fields;
    if(!sheet)return;
    const old=sheet.getRange(1,1,1,fields.length).getValues()[0];
    if(oscEqual_(old,fields)){sheet.getRange(1,1,1,fields.length).setValues([fields.map(function(f){if(!labels[f])oscFail_('CONTROLE_TITULO_SEM_TRADUCAO');return labels[f];})]);
      fields.forEach(function(f,i){if(/At$/.test(f)||f==='timestamp')sheet.getRange(2,i+1,sheet.getMaxRows()-1,1).setNumberFormat('dd/MM/yyyy HH:mm');});}
  });
}

/** Restore only the most recent removal, with a source precondition and a new audit entry. */
function restaurarUltimaExclusaoPlanilhaV1() {
  oscOwner_();
  return oscLocked_(function(){
    const p=sahmtV2Properties_(),id=p.getProperty('SAHMT_OPERATIONAL_LAST_DELETION');if(!id)oscFail_('CONTROLE_SEM_EXCLUSAO_PARA_RESTAURAR');
    const archive=oscGet_(OSC.archive+'/'+id);if(!archive)oscFail_('CONTROLE_COPIA_AUSENTE');
    const saved=firestoreFieldsToJs_(archive.fields),original=JSON.parse(saved.snapshotJson),key=oscDocKey_(original),current=oscGet_(key),now=new Date();
    const tombstone=current&&firestoreFieldsToJs_(current.fields);
    if(!tombstone||!tombstone.sheetDeleted||tombstone.sheetArchiveId!==id)oscFail_('CONTROLE_RESTAURACAO_CONFLITANTE');
    const values=firestoreFieldsToJs_(original.fields);values.updatedAt=now;values.version=tombstone.version+1;
    const writes=[{update:{name:current.name,fields:firestoreFieldsFromJs_(values)},currentDocument:{updateTime:current.updateTime}}];
    writes.push.apply(writes,oscScheduleWrites_(key,values,values,now));
    firestoreRequest_(firestoreDocumentsUrl_(':commit'),{method:'post',contentType:'application/json',payload:JSON.stringify({writes:writes})});
    p.deleteProperty('SAHMT_OPERATIONAL_LAST_DELETION');
    return oscResult_('CONTROLE_ULTIMA_EXCLUSAO_RESTAURADA');
  });
}
