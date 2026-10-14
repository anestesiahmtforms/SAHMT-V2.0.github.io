import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const files = ['Config.gs','ChecklistRotationCore.gs','ChecklistValidation.gs','ChecklistScienceRelease.gs','ChecklistProjection.gs','EvaluationLedger.gs','EvaluationChecklistDelivery.gs','EvaluationOccurrenceDelivery.gs'];
const source = files.map(file => readFileSync(new URL('../apps-script-v2/'+file, import.meta.url), 'utf8')).join('\n');
const plain = value => JSON.parse(JSON.stringify(value));
export function harness({activated = true, project = 'FB'} = {}) {
  const store = new Map(), transactions = new Map(), commits = [], requests = [];
  let counter = 0, beforeCommit;
  const properties = new Map([['SAHMT_V2_EVALUATION_ALLOWED_EMAILS','operator@example.invalid']]);
  const ctx = vm.createContext({Date, Map, Set, JSON, Number, Object, Array, String, RegExp, Error, console,
    encodeURIComponent, Session:{getEffectiveUser:()=>({getEmail:()=> 'operator@example.invalid'})},
    Utilities:{DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},computeDigest:(_algorithm,text)=>Array.from(createHash('sha256').update(text).digest()),
      formatDate:()=>'2026-10-03'}, PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key)||null})}});
  if (project === 'FB') properties.set('SAHMT_V2_EVALUATION_PROJECT_ID', 'sahmt-gestao-5ae66');
  vm.runInContext(source, ctx);
  ctx.sahmtV2Properties_ = () => ({getProperty:key=>properties.get(key)||null,setProperty:(key,value)=>properties.set(key,value)});
  const name = (collection,id) => ctx.evaluationDocumentName_(collection,id);
  function seed(collection,id,data) { const doc = {name:name(collection,id), fields:plain(ctx.firestoreFieldsFromJs_(data)), updateTime:`v${++counter}`, createTime:`v${counter}`}; store.set(doc.name,doc); return doc; }
  function data(collection,id) { const item=store.get(name(collection,id)); return item ? plain(ctx.firestoreFieldsToJs_(item.fields)) : null; }
  function get(collection,id) { const doc=store.get(name(collection,id)); return doc ? ctx.evaluationDocument_(doc) : null; }
  function value(fields, field) { let result=ctx.firestoreFieldsToJs_(fields); for(const part of field.split('.')) result=result?.[part]; return result; }
  function queryFilter(doc, filter) {
    if (filter.compositeFilter) return filter.compositeFilter.filters.every(item=>queryFilter(doc,item));
    const field=filter.fieldFilter, current=value(doc.fields,field.field.fieldPath), target=ctx.firestoreValueToJs_(field.value);
    return field.op==='EQUAL' ? current===target : field.op==='LESS_THAN_OR_EQUAL' ? current<=target : field.op==='GREATER_THAN_OR_EQUAL' ? current>=target : false;
  }
  function track(tx,docName) { if(tx) transactions.get(tx).reads.set(docName,transactions.get(tx).snapshot.get(docName)?.updateTime || null); }
  ctx.firestoreRequest_ = (url, options={}) => {
    const body=options.payload ? JSON.parse(options.payload) : {}; requests.push({url,body});
    if (url.endsWith(':beginTransaction')) { const transaction=`tx${++counter}`; transactions.set(transaction,{project:url.match(/projects\/([^/]+)/)[1],snapshot:new Map(Array.from(store,([key,item])=>[key,plain(item)])),reads:new Map()}); return {transaction}; }
    if (url.endsWith(':rollback')) { transactions.delete(body.transaction); return {}; }
    if (url.endsWith(':batchGet')) return body.documents.map(docName=>{track(body.transaction,docName);const doc=transactions.get(body.transaction).snapshot.get(docName);return doc ? {found:plain(doc)} : {missing:docName};});
    if (url.endsWith(':runQuery')) {
      const query=body.structuredQuery, prefix=url.match(/projects\/[^/]+\/databases\/[^/]+\/documents/)[0]+'/'+query.from[0].collectionId+'/';
      const db=body.transaction ? transactions.get(body.transaction).snapshot : store;
      let docs=Array.from(db.values()).filter(doc=>doc.name.startsWith(prefix) && (!query.where || queryFilter(doc,query.where)));
      if(query.orderBy) docs.sort((a,b)=>{for(const order of query.orderBy) { const av=value(a.fields,order.field.fieldPath),bv=value(b.fields,order.field.fieldPath); const compare=av>bv?1:av<bv?-1:0;if(compare) return order.direction==='DESCENDING' ? -compare : compare; } return a.name.localeCompare(b.name);});
      docs=docs.slice(0,query.limit); docs.forEach(doc=>track(body.transaction,doc.name));
      return docs.map(doc=>({document:plain(doc)}));
    }
    if (url.endsWith(':commit')) {
      if(beforeCommit) {const callback=beforeCommit;beforeCommit=null;callback(body);}
      const tx=body.transaction && transactions.get(body.transaction);
      if (tx && tx.project !== url.match(/projects\/([^/]+)/)[1]) throw new Error('CROSS_PROJECT_TX');
      if (body.writes.some(w => !w.update.name.startsWith('projects/'+url.match(/projects\/([^/]+)/)[1]+'/'))) throw new Error('CROSS_PROJECT_WRITE');
      if(tx) for(const [docName,version] of tx.reads) if((store.get(docName)?.updateTime || null)!==version) throw Object.assign(new Error('ABORTED'),{status:409});
      for(const write of body.writes) { const current=store.get(write.update.name),condition=write.currentDocument;
        if(condition?.exists===false && current || condition?.updateTime && current?.updateTime!==condition.updateTime) throw Object.assign(new Error('CAS failed'),{status:409});
      }
      for(const write of body.writes) {
        const previous=store.get(write.update.name), fields=write.updateMask ? {...(previous?.fields||{})} : {};
        if(write.updateMask) for(const field of write.updateMask.fieldPaths) { if(write.update.fields[field])fields[field]=write.update.fields[field];else delete fields[field]; }
        else Object.assign(fields,write.update.fields);
        for(const transform of write.updateTransforms || []) fields[transform.fieldPath]={timestampValue:'2026-10-03T12:00:00.000Z'};
        store.set(write.update.name,{name:write.update.name,fields:plain(fields),updateTime:`v${++counter}`,createTime:previous?.createTime || `v${counter}`});
      }
      commits.push(body); transactions.delete(body.transaction); return {commitTime:'2026-10-03T12:00:00.000Z'};
    }
    const matched=/\/documents\/([^/?]+)\/([^/?]+)/.exec(url);
    if(matched) {const doc=store.get(decodeURIComponent(url.match(/projects\/[^?]+/)[0]));if(!doc)throw Object.assign(new Error('missing'),{status:404});return plain(doc);}
    throw new Error(`Unexpected mock request ${url}`);
  };
  if (activated) {
    properties.set('SAHMT_V2_EVALUATION_ENABLED','true'); properties.set('SAHMT_V2_EVALUATION_HOMOLOGATED','true');
    seed('evaluationRuntime','state',{homologationVerified:true});
  }
  return {ctx,seed,data,get,store,commits,requests,properties,values:collection=>Array.from(store.values()).filter(doc=>doc.name.startsWith(name(collection,''))).map(doc=>plain(ctx.firestoreFieldsToJs_(doc.fields))),beforeCommit:callback=>{beforeCommit=callback;}};
}
