import {createHash} from 'node:crypto';
import {isDosimetryYear,normalizeProfessionalName,validateDosimetryRecord,dosimetryMonths} from '../../src/dosimetry-domain.js';
const email=v=>String(v||'').trim().toLowerCase();
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function buildDosimetryImportPlan({extraction,bindings,profiles,contacts,pdfFingerprint,existing=[]}){
 if(!isDosimetryYear(extraction?.year)||extraction.sha256!==pdfFingerprint||!Array.isArray(extraction.rows)||!Array.isArray(bindings)||!Array.isArray(profiles)||!Array.isArray(contacts)||extraction.extractionMethod!=='rendered-pdf-visual-review')throw Error('DOSIMETRY_SOURCE_INVALID');
 const codes=new Set(),sourceNames=new Set();for(const row of extraction.rows){if(!/^\d{3}$/.test(row.code)||codes.has(row.code)||!normalizeProfessionalName(row.name)||sourceNames.has(normalizeProfessionalName(row.name)))throw Error('DOSIMETRY_SOURCE_AMBIGUOUS');codes.add(row.code);sourceNames.add(normalizeProfessionalName(row.name));dosimetryMonths(row.months);if(row.months.filter(v=>v!==null).length!==row.monthsReported)throw Error('DOSIMETRY_MONTH_COUNT_MISMATCH');}
 const uids=new Set(),emails=new Set(),usedCodes=new Set(),documents=[];
 for(const binding of bindings){
  if(uids.has(binding.uid)||emails.has(email(binding.email))||usedCodes.has(binding.code))throw Error('DOSIMETRY_BINDING_AMBIGUOUS');
  const row=extraction.rows.find(r=>r.code===binding.code),matches=profiles.filter(p=>p.uid===binding.uid&&email(p.email)===email(binding.email));
  if(!row||normalizeProfessionalName(row.name)!==normalizeProfessionalName(binding.sourceName)||matches.length!==1||matches[0].active!==true||matches[0].access!==true||matches[0].id&&matches[0].id!==matches[0].uid)throw Error('DOSIMETRY_PROFILE_MISMATCH');
  if(binding.matchMethod==='official-contact-name-and-email'){
   const found=contacts.filter(c=>c.sigla===binding.contactSigla&&email(c.email)===email(binding.email)&&normalizeProfessionalName(c.name)===normalizeProfessionalName(row.name));if(found.length!==1)throw Error('DOSIMETRY_CONTACT_MISMATCH');
  }else if(binding.matchMethod!=='user-confirmed-binding'||binding.confirmedByUser!==true)throw Error('DOSIMETRY_BINDING_NOT_REVIEWED');
  const data={schemaVersion:1,status:'VERIFIED',uid:binding.uid,email:email(binding.email),year:extraction.year,sourceName:row.name,values:row.months,monitorType:row.monitorType,quantity:extraction.quantity,unit:extraction.unit,issuedOn:extraction.issuedOn,sourceFingerprint:pdfFingerprint,sourceFileId:extraction.fileId,sourceFolderId:extraction.folderId,matchMethod:binding.matchMethod};
  validateDosimetryRecord(data);const id=`${binding.uid}_${extraction.year}`,previous=existing.find(r=>r.id===id);
  if(previous&&(previous.uid!==binding.uid||email(previous.email)!==email(binding.email)))throw Error('DOSIMETRY_EXISTING_IDENTITY_CONFLICT');
  if(previous&&previous.sourceFingerprint!==pdfFingerprint)throw Error('DOSIMETRY_NEW_REPORT_REVIEW_REQUIRED');
  const comparable=previous?Object.fromEntries(Object.keys(data).map(k=>[k,previous[k]])):null;
  documents.push({path:'occupationalDosimetry/'+id,data,changed:digest(data)!==digest(comparable),exists:!!previous,updateTime:previous?.updateTime||null});uids.add(binding.uid);emails.add(email(binding.email));usedCodes.add(binding.code);
 }
 return {projectId:'sahmt-gestao-5ae66',documents,pendingCodes:extraction.rows.filter(r=>!usedCodes.has(r.code)).map(r=>r.code),revision:digest(documents.map(d=>d.data)),summary:{sourceRows:extraction.rows.length,verifiedProfessionals:documents.length,pendingProfessionals:extraction.rows.length-documents.length,changes:documents.filter(d=>d.changed).length}};
}
