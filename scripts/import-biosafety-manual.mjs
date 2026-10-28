import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {encodeFields,decodeFields} from '../worker-training/firestore.js';
import {validateManualRecord} from '../src/biosafety-manual-policy.js';
import {validateManualHtmlStructure} from './lib/biosafety-manual-import.js';
const args=process.argv.slice(2),arg=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const paths=['source','html','metadata'].map(name=>arg('--'+name));if(paths.some(p=>!p))throw Error('Use --source PRIVATE_DOCX --html PRIVATE_HTML --metadata PRIVATE_JSON [--apply]');
const [source,html,metadata]=await Promise.all([fs.readFile(paths[0]),fs.readFile(paths[1],'utf8'),fs.readFile(paths[2],'utf8').then(JSON.parse)]);
if(source.subarray(0,2).toString()!=='PK'||createHash('sha256').update(source).digest('hex')!==metadata.sourceSha256)throw Error('MANUAL_SOURCE_MISMATCH');
const record={schemaVersion:metadata.schemaVersion,status:metadata.status,title:metadata.title,documentCode:metadata.documentCode,revision:metadata.revision,issuedOn:metadata.issuedOn,sourceSha256:metadata.sourceSha256,contentSha256:metadata.contentSha256,html};await validateManualRecord(record);const structure=validateManualHtmlStructure(html);
const token=await firebaseCliAccountToken('anestesiahmtforms2@gmail.com'),root='projects/sahmt-gestao-5ae66/databases/(default)/documents',path='/institutionalBiosafetyManuals/hmt';
async function api(suffix,body){const r=await fetch('https://firestore.googleapis.com/v1/'+root+suffix,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});if(!body&&r.status===404)return null;if(!r.ok){await r.body?.cancel();throw Error('MANUAL_IMPORT_HTTP_'+r.status);}return r.json();}
const same=value=>!!value&&Object.keys(value).length===Object.keys(record).length&&Object.keys(record).every(k=>value[k]===record[k]);
const previous=await api(path),old=previous?decodeFields(previous.fields):null,changed=!same(old),apply=args.includes('--apply');
await fs.mkdir('.local-preview/biosafety-manual',{recursive:true});
if(apply&&changed){await fs.writeFile('.local-preview/biosafety-manual/before-import.private.json',JSON.stringify(previous));await api(':commit',{writes:[{update:{name:root+path,fields:encodeFields(record)},currentDocument:previous?{updateTime:previous.updateTime}:{exists:false}}]});const after=decodeFields((await api(path)).fields);await validateManualRecord(after);if(!same(after))throw Error('MANUAL_IMPORT_VERIFY_FAILED');}
console.log(JSON.stringify({applied:apply,changed,htmlBytes:Buffer.byteLength(html),...structure,sharingChanges:0}));
