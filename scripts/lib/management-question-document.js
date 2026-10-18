import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {XMLParser} from 'fast-xml-parser';
const fail=code=>{throw Error(code);};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone=value=>structuredClone(value);
const choices=form=>(form.items||[]).filter(i=>i.questionItem?.question?.choiceQuestion?.options?.length>=2);
export function questionDocumentModel(snapshot){
 const form=snapshot?.form;if(!form?.formId||form.formId!==snapshot.formId||!form.revisionId)fail('QUESTION_DOCUMENT_SOURCE_INVALID');
 const questions=choices(form).map(item=>{
  const q=item.questionItem.question,c=q.choiceQuestion,answers=q.grading?.correctAnswers?.answers?.map(a=>a.value)||[],issues=[];
  if(!answers.length)issues.push('SEM_GABARITO_CONFIGURADO');
  if(answers.some(a=>!c.options.some(o=>o.value===a)))issues.push('GABARITO_NAO_CORRESPONDE_AS_ALTERNATIVAS');
  if(['RADIO','DROP_DOWN'].includes(c.type)&&answers.length>1)issues.push('MAIS_DE_UMA_RESPOSTA_EM_ESCOLHA_UNICA');
  if(item.questionItem.image||c.options.some(o=>o.image))issues.push('QUESTAO_COM_IMAGEM');
  return {itemId:item.itemId,questionId:q.questionId,nativeItemId:item.nativeItemId??null,title:item.title||'',description:item.description||'',type:c.type,points:q.grading?.pointValue||0,required:q.required===true,
   options:c.options.map((o,i)=>({label:String.fromCharCode(65+i),text:o.value,correct:answers.includes(o.value)})),issues};
 });
 if(questions.some(q=>!q.itemId||!q.questionId)||new Set(questions.map(q=>q.questionId)).size!==questions.length)fail('QUESTION_DOCUMENT_IDENTITY_INVALID');
 return {schemaVersion:1,formId:form.formId,folderId:snapshot.folderId,folderTitle:snapshot.folderTitle,title:snapshot.folderTitle||form.info?.title||'Questões',sourceSchema:form.sourceSchema||'FORMS_API_V1',sourceRevision:form.revisionId,bankSha256:hash(choices(form)),questions};
}
const elements=(nodes,name)=>(nodes||[]).filter(n=>Object.hasOwn(n,name)).map(n=>n[name]);
function xmlText(nodes){
 let out='';for(const node of nodes||[])for(const [key,value]of Object.entries(node)){
  if(key==='#text')out+=String(value);
  else if(key==='br')out+='\n';
  else if(key==='tab')out+='\t';
  else if(key==='p')out+=xmlText(value)+'\n';
  else if(['r','t','hyperlink','sdt','sdtContent'].includes(key))out+=xmlText(value);
 }return out;
}
export function parseQuestionDocx(bytes,baseline){
 if(bytes.byteLength>20*1024*1024)fail('QUESTION_DOCUMENT_TOO_LARGE');
 const archive=unzipSync(new Uint8Array(bytes)),xml=archive['word/document.xml'];if(!xml||xml.byteLength>8*1024*1024)fail('QUESTION_DOCUMENT_XML_INVALID');
 const text=Buffer.from(xml).toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(text))fail('QUESTION_DOCUMENT_XML_INVALID');
 const doc=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,trimValues:false,processEntities:true,preserveOrder:true}).parse(text);
 const body=elements(elements(doc,'document')[0],'body')[0];
 const tables=elements(body,'tbl'),questions=[];let pending=null;
 for(const table of tables){
  const rows=elements(table,'tr').map(r=>elements(r,'tc').map(c=>xmlText(c).replace(/\n$/,'')));
  if(rows[0]?.[0]==='Código da questão'){
   if(pending)fail('QUESTION_DOCUMENT_LAYOUT_INVALID');const get=key=>rows.find(r=>r[0]===key)?.[1];
   pending={questionId:rows[0][1],title:get('Pergunta')??'',description:get('Descrição')??'',points:Number(get('Pontos')),options:[]};
  }else if(['Alternativa|Texto|Gabarito','Opção|Texto|Gabarito'].includes(rows[0]?.join('|'))){
   if(!pending)fail('QUESTION_DOCUMENT_LAYOUT_INVALID');
   pending.options=rows.slice(1).map((r,i)=>{if(r.length!==3||r[0]!==String.fromCharCode(65+i))fail('QUESTION_DOCUMENT_OPTION_INVALID');const mark=r[2].normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();if(!['','CORRETA','RESPOSTA CORRETA'].includes(mark))fail('QUESTION_DOCUMENT_ANSWER_MARK_INVALID');return {label:r[0],text:r[1],correct:Boolean(mark)};});
   questions.push(pending);pending=null;
  }
 }
 if(pending)fail('QUESTION_DOCUMENT_LAYOUT_INVALID');
 if(questions.length!==baseline.questions.length||new Set(questions.map(q=>q.questionId)).size!==questions.length||questions.some(q=>!baseline.questions.some(b=>b.questionId===q.questionId)))fail('QUESTION_DOCUMENT_QUESTION_SET_CHANGED');
 return {...clone(baseline),questions};
}
/** Preparation only. The approved immutable document hash and current manager assignment must be checked by the server before application. */
export function prepareQuestionChangePlan({baseline,currentForm,edited}){
 if(currentForm?.formId!==baseline.formId||edited?.formId!==baseline.formId||hash(choices(currentForm))!==baseline.bankSha256)fail('QUESTION_DOCUMENT_FORM_CHANGED');
 if(edited.questions?.length!==baseline.questions.length||new Set(edited.questions.map(q=>q.questionId)).size!==baseline.questions.length)fail('QUESTION_DOCUMENT_QUESTION_SET_CHANGED');
 const requests=[];
 for(const before of baseline.questions){
  const next=edited.questions.find(q=>q.questionId===before.questionId);if(!next||typeof next.title!=='string'||!next.title.trim()||next.title.length>10000||typeof next.description!=='string'||next.description.length>20000||next.points!==before.points)fail('QUESTION_DOCUMENT_CONTENT_INVALID');
  if(!Array.isArray(next.options)||next.options.length!==before.options.length||next.options.some(o=>typeof o.text!=='string'||!o.text.trim()||o.text.length>10000||typeof o.correct!=='boolean')||new Set(next.options.map(o=>o.text)).size!==next.options.length)fail('QUESTION_DOCUMENT_OPTION_INVALID');
  const correct=next.options.filter(o=>o.correct);if(!correct.length||(['RADIO','DROP_DOWN'].includes(before.type)&&correct.length!==1))fail('QUESTION_DOCUMENT_ANSWER_INVALID');
  if(before.issues.includes('QUESTAO_COM_IMAGEM'))fail('QUESTION_DOCUMENT_IMAGE_REVIEW_REQUIRED');
  // Empty optional fields and provider-only metadata must not turn an untouched DOCX into a write.
  if(next.title===before.title&&next.description===before.description&&next.options.every((o,i)=>o.text===before.options[i].text&&o.correct===before.options[i].correct))continue;
  const index=currentForm.items.findIndex(i=>i.itemId===before.itemId),item=clone(currentForm.items[index]);if(!item||item.questionItem.question.questionId!==before.questionId)fail('QUESTION_DOCUMENT_IDENTITY_INVALID');
  const q=item.questionItem.question;item.title=next.title;item.description=next.description;
  q.choiceQuestion.options=q.choiceQuestion.options.map((o,i)=>({...o,value:next.options[i].text}));
  q.grading={...q.grading,correctAnswers:{answers:correct.map(o=>({value:o.text}))}};
  if(JSON.stringify(item)!==JSON.stringify(currentForm.items[index]))requests.push({updateItem:{item,location:{index},updateMask:'title,description,questionItem.question.choiceQuestion.options,questionItem.question.grading.correctAnswers'}});
 }
 return {code:requests.length?'QUESTION_DOCUMENT_REVIEW_REQUIRED':'QUESTION_DOCUMENT_UNCHANGED',formId:baseline.formId,changedQuestions:requests.length,applicationBlocked:true,bankBeforeSha256:baseline.bankSha256,editedDocumentSha256:hash(edited),
  batchUpdate:baseline.sourceSchema==='FORMS_API_V1'?{writeControl:{requiredRevisionId:currentForm.revisionId},requests}:null};
}
