import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfessionalDocumentService} from '../worker-training/professional-documents.js';

const copy=x=>x==null?null:structuredClone(x);
function setup({ready=true}={}){
 const data=new Map(),files=new Map();let queue=Promise.resolve(),seq=0;
 const store={get:async(c,id)=>copy(data.get(c+'/'+id)),list:async(c,filters=[])=>[...data].filter(([k,d])=>k.startsWith(c+'/')&&filters.every(f=>d[f.field]===f.value)).map(([k,d])=>({id:k.slice(c.length+1),...copy(d)})),
 transaction(fn){const run=queue.then(async()=>{const writes=[];const result=await fn({get:store.get,set:(c,id,d)=>writes.push([c+'/'+id,copy(d)]),create:(c,id,d)=>{assert.ok(!data.has(c+'/'+id));writes.push([c+'/'+id,copy(d)]);}});for(const [k,v]of writes)data.set(k,v);return result;});queue=run.catch(()=>{});return run;}};
 const actor=uid=>({uid,email:uid+'@example.invalid',emailVerified:true,provider:'google.com'});
 for(const uid of ['one','two','admin','manager']){data.set('users/'+uid,{uid,email:actor(uid).email,displayName:uid,active:true,access:true,role:uid==='admin'?'administrador_app':'colaborador',permissions:uid==='manager'?{peopleManage:true,managementManage:true}:{}});data.set('professionalDocumentFolders/'+uid,{uid,email:actor(uid).email,active:true,rootFolderId:'root',professionalFolderId:'folder-'+uid,categories:{VACCINATION:'vac-'+uid}});}
 const drive={ready,allocateId:async()=>`file-${++seq}`,verifyDestination:async(folder,parent,root)=>{if(!folder.startsWith('vac-')||!parent.startsWith('folder-')||root!=='root')throw Error('Bad destination');},getFile:async id=>copy(files.get(id)),upload:async item=>{if(files.has(item.id))throw Object.assign(Error('exists'),{status:409});files.set(item.id,{id:item.id,parents:[item.folderId],appProperties:{sahmtDigest:item.digest},shared:false,mimeType:item.mimeType,size:String(item.bytes.length)});return copy(files.get(item.id));}};
 const service=createProfessionalDocumentService({store,drive,now:()=>1793200000000});
 const input={context:'VACCINATION',year:2026,subject:'hepatitisB',requestId:'d115646b-7d9d-4460-a3a4-101778400001',mimeType:'application/pdf',dataBase64:Buffer.from('%PDF-1.7\nsynthetic fixture\n%%EOF').toString('base64')};
 return{data,files,store,drive,actor,service,input,exec:(action,input,uid='one')=>service.execute(action,input,actor(uid))};
}
test('server binds destination and sender to authenticated profile; own list has no Drive URLs',async()=>{
 const h=setup();await h.exec('UPLOAD',h.input);
 const own=await h.exec('LIST_OWN',{context:'VACCINATION',year:2026});assert.equal(own.documents.length,1);assert.equal(own.documents[0].status,'STORED');assert.ok(!JSON.stringify(own).includes('drive.google.com'));assert.ok(!JSON.stringify(own).includes('file-'));
 assert.equal((await h.exec('LIST_OWN',{context:'VACCINATION',year:2026},'two')).documents.length,0);
 const saved=[...h.data].find(([k])=>k.startsWith('professionalDocumentUploads/'))[1];assert.equal(saved.uid,'one');assert.equal(saved.email,'one@example.invalid');assert.equal([...h.files.values()][0].parents[0],'vac-one');assert.ok(!('dataBase64'in saved));
});
test('folder, uid, and email injection rejected before upload',async()=>{for(const extra of [{folderId:'vac-two'},{uid:'two'},{email:'two@example.invalid'}]){const h=setup();await assert.rejects(h.exec('UPLOAD',{...h.input,...extra}),e=>e.status===400);assert.equal(h.files.size,0);}});
test('same request retry is idempotent, altered bytes conflict, concurrent retry uses one Drive file',async()=>{
 const h=setup();await Promise.all([h.exec('UPLOAD',h.input),h.exec('UPLOAD',h.input)]);assert.equal(h.files.size,1);await h.exec('UPLOAD',h.input);assert.equal(h.files.size,1);
 await assert.rejects(h.exec('UPLOAD',{...h.input,dataBase64:Buffer.from('%PDF-1.7\nother\n%%EOF').toString('base64')}),e=>e.status===409);
});
test('admin alone can access document references; revoked admin blocked',async()=>{
 const h=setup();await h.exec('UPLOAD',h.input);for(const who of ['one','manager'])await assert.rejects(h.exec('LIST_ADMIN',{context:'VACCINATION',year:2026},who),e=>e.status===403);
 const report=await h.exec('LIST_ADMIN',{context:'VACCINATION',year:2026},'admin');assert.equal(report.documents.length,1);assert.match(report.documents[0].url,/^https:\/\/drive.google.com\/file\/d\/file-/);
 h.data.get('users/admin').active=false;await assert.rejects(h.exec('LIST_ADMIN',{context:'VACCINATION',year:2026},'admin'),e=>e.status===403);
});
test('unconnected Drive gives explicit readiness and never creates pending uploads',async()=>{const h=setup({ready:false});const r=await h.exec('LIST_OWN',{context:'VACCINATION',year:2026});assert.equal(r.uploadsEnabled,false);await assert.rejects(h.exec('UPLOAD',h.input),e=>e.status===503);assert.equal([...h.data.keys()].filter(x=>x.startsWith('professionalDocumentUploads/')).length,0);});
test('missing folder and mismatched profile email deny writes',async()=>{const h=setup();h.data.get('professionalDocumentFolders/one').email='two@example.invalid';await assert.rejects(h.exec('UPLOAD',h.input),e=>e.status===403);h.data.get('users/one').email='two@example.invalid';await assert.rejects(h.exec('LIST_OWN',{context:'VACCINATION',year:2026}),e=>e.status===403);});
test('file signature, oversized PDF, invalid subject/year/base64 are refused',async()=>{
 for(const patch of [{dataBase64:Buffer.from('<script>not a PDF</script>').toString('base64')},{mimeType:'image/svg+xml'},{year:2025},{subject:'../../other'},{dataBase64:'%%%='},{dataBase64:Buffer.alloc(5*1024*1024+1).toString('base64')}]){const h=setup();await assert.rejects(h.exec('UPLOAD',{...h.input,...patch}),e=>[400,413].includes(e.status));assert.equal(h.files.size,0);}
});
test('Drive succeeds but final store save fails: retry reconciles the reserved file',async()=>{
 const h=setup(),transaction=h.store.transaction.bind(h.store);let rejectFinal=true;
 h.store.transaction=fn=>transaction(async tx=>{const result=await fn(tx);if(result?.document?.status==='STORED'&&rejectFinal){rejectFinal=false;throw Error('connection interrupted');}return result;});
 await assert.rejects(h.exec('UPLOAD',h.input));assert.equal(h.files.size,1);const recovered=await h.exec('UPLOAD',h.input);assert.equal(recovered.document.status,'STORED');assert.equal(h.files.size,1);
});

test('pending upload cannot reuse an obsolete or revoked destination',async()=>{
 const h=setup();h.drive.upload=async()=>{throw Error('temporary connection failure');};await assert.rejects(h.exec('UPLOAD',h.input));
 h.data.get('professionalDocumentFolders/one').categories.VACCINATION='vac-reassigned';
 await assert.rejects(h.exec('UPLOAD',h.input),e=>e.code==='DOCUMENT_FOLDER_CHANGED');assert.equal(h.files.size,0);
});
 test('recovered file shared externally is never confirmed to the participant',async()=>{
 const h=setup(),transaction=h.store.transaction.bind(h.store);let failFinal=true;
 h.store.transaction=fn=>transaction(async tx=>{const r=await fn(tx);if(r?.document?.status==='STORED'&&failFinal){failFinal=false;throw Error('interrupted');}return r;});
 await assert.rejects(h.exec('UPLOAD',h.input));const file=[...h.files.values()][0];file.shared=true;h.files.set(file.id,file);
 await assert.rejects(h.exec('UPLOAD',h.input));const row=[...h.data].find(([k])=>k.startsWith('professionalDocumentUploads/'))[1];assert.equal(row.status,'PENDING');
 });
