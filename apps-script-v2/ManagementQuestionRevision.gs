// Internal native-Forms adapter. No production watcher or public mutation entry point.
function gqrSnapshot_(form) {
  const items=[];
  form.getItems().forEach(function(item){
    const type=String(item.getType());let q,choiceType;
    if(type==='MULTIPLE_CHOICE'){q=item.asMultipleChoiceItem();choiceType='RADIO';}
    else if(type==='CHECKBOX'){q=item.asCheckboxItem();choiceType='CHECKBOX';}
    else if(type==='LIST'){q=item.asListItem();choiceType='DROP_DOWN';}else return;
    const choices=q.getChoices();
    items.push({itemId:'gas_'+item.getId(),nativeItemId:item.getId(),title:q.getTitle(),description:q.getHelpText()||'',questionItem:{question:{questionId:'gas_'+item.getId(),required:q.isRequired(),grading:{pointValue:q.getPoints(),correctAnswers:{answers:choices.filter(function(c){return c.isCorrectAnswer();}).map(function(c){return {value:c.getValue()};})}},choiceQuestion:{type:choiceType,options:choices.map(function(c){return {value:c.getValue()};})}}}});
  });
  return {formId:form.getId(),revisionId:'native',sourceSchema:'FORMAPP_V1',items:items};
}
function gqrModel_(snapshot) {
  return {schemaVersion:1,formId:snapshot.formId,sourceSchema:'FORMAPP_V1',bankSha256:gqeHash_(snapshot.items),questions:snapshot.items.map(function(item){const q=item.questionItem.question;return {questionId:q.questionId,itemId:item.itemId,nativeItemId:item.nativeItemId,title:item.title,description:item.description,points:q.grading.pointValue,type:q.choiceQuestion.type,required:q.required,options:q.choiceQuestion.options.map(function(o,i){return {label:String.fromCharCode(65+i),text:o.value,correct:q.grading.correctAnswers.answers.some(function(a){return a.value===o.value;})};})};})};
}
function gqrWordText_(element) {
  const name=element.getName();if(name==='t')return element.getText();if(name==='br')return '\n';if(name==='tab')return '\t';
  return element.getChildren().map(gqrWordText_).join('')+(name==='p'?'\n':'');
}
function gqrRows_(blob) {
  if(blob.getBytes().length>20*1024*1024)throw Error('QUESTION_REVISION_DOCUMENT_TOO_LARGE');
  const xml=Utilities.unzip(blob.copyBlob().setContentType('application/zip')).find(function(part){return part.getName()==='word/document.xml';});
  if(!xml||xml.getBytes().length>8*1024*1024)throw Error('QUESTION_REVISION_XML_INVALID');
  const text=xml.getDataAsString('UTF-8');if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('QUESTION_REVISION_XML_INVALID');
  const root=XmlService.parse(text).getRootElement(),body=root.getChildren().find(function(e){return e.getName()==='body';});
  if(!body)throw Error('QUESTION_REVISION_XML_INVALID');
  return body.getChildren().filter(function(e){return e.getName()==='tbl';}).map(function(t){return t.getChildren().filter(function(e){return e.getName()==='tr';}).map(function(r){return r.getChildren().filter(function(e){return e.getName()==='tc';}).map(function(c){return gqrWordText_(c).replace(/\n$/,'');});});});
}
function gqrParse_(tables,baseline) {
  const edited=JSON.parse(JSON.stringify(baseline));edited.questions=[];let pending=null;
  tables.forEach(function(rows){
    if(rows[0]&&rows[0][0]==='Código da questão'){
      if(pending)throw Error('QUESTION_REVISION_LAYOUT_INVALID');
      const field=function(name){const r=rows.find(function(row){return row[0]===name;});return r&&r[1];};
      pending={questionId:rows[0][1],title:field('Pergunta')||'',description:field('Descrição')||'',points:Number(field('Pontos')),options:[]};
    }else if(rows[0]&&['Opção|Texto|Gabarito','Alternativa|Texto|Gabarito'].includes(rows[0].join('|'))){
      if(!pending)throw Error('QUESTION_REVISION_LAYOUT_INVALID');
      pending.options=rows.slice(1).map(function(r,i){
        const mark=String(r[2]||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
        if(r.length!==3||r[0]!==String.fromCharCode(65+i)||!['','CORRETA','RESPOSTA CORRETA'].includes(mark))throw Error('QUESTION_REVISION_OPTION_INVALID');
        return {label:r[0],text:r[1],correct:Boolean(mark)};
      });edited.questions.push(pending);pending=null;
    }
  });
  if(pending||edited.questions.length!==baseline.questions.length||new Set(edited.questions.map(function(q){return q.questionId;})).size!==baseline.questions.length||edited.questions.some(function(q){return !baseline.questions.some(function(b){return b.questionId===q.questionId;});}))throw Error('QUESTION_REVISION_QUESTION_SET_CHANGED');
  return edited;
}
function gqrPlan_(baseline,current,edited) {
  if(!baseline||current.formId!==baseline.formId||edited.formId!==baseline.formId||gqeHash_(current.items)!==baseline.bankSha256)throw Error('QUESTION_REVISION_FORM_CHANGED');
  if(edited.questions.length!==baseline.questions.length||new Set(edited.questions.map(function(q){return q.questionId;})).size!==baseline.questions.length)throw Error('QUESTION_REVISION_QUESTION_SET_CHANGED');
  const changed=[];
  baseline.questions.forEach(function(before){
    const next=edited.questions.find(function(q){return q.questionId===before.questionId;});
    if(!next||typeof next.title!=='string'||!next.title.trim()||next.title.length>10000||typeof next.description!=='string'||next.description.length>20000||next.points!==before.points)throw Error('QUESTION_REVISION_CONTENT_INVALID');
    if(!Array.isArray(next.options)||next.options.length!==before.options.length||next.options.some(function(o){return typeof o.text!=='string'||!o.text.trim()||o.text.length>10000||typeof o.correct!=='boolean';})||new Set(next.options.map(function(o){return o.text;})).size!==next.options.length)throw Error('QUESTION_REVISION_OPTION_INVALID');
    const correct=next.options.filter(function(o){return o.correct;});
    if(!correct.length||(['RADIO','DROP_DOWN'].includes(before.type)&&correct.length!==1))throw Error('QUESTION_REVISION_ANSWER_INVALID');
    if(next.title!==before.title||next.description!==before.description||next.options.some(function(o,i){return o.text!==before.options[i].text||o.correct!==before.options[i].correct;}))changed.push({before:before,after:next});
  });return {formId:baseline.formId,changed:changed};
}
function gqrEditedHash_(edited) {
  return gqeHash_({formId:edited.formId,questions:edited.questions.map(function(q){return {questionId:q.questionId,title:q.title,description:q.description,points:q.points,options:q.options};})});
}
