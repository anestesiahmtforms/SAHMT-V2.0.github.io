/** Data-only planner; no API calls on definition. */
const SAHMT_TRAINING_TEMPLATE_PLANNER=(function(){


const requireValue = (ok, code) => { if (!ok) throw Error(code); };
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => formsEvaluationHash_(value);
const PREFIXES = ['[SAHMT:IDENTIFICATION]', '[SAHMT:MATERIAL]', '[SAHMT:ACK]', '[SAHMT:SUGGESTION]',
  '[SAHMT:SUGGESTION_PROBLEM]', '[SAHMT:SUGGESTION_PROPOSAL]', '[SAHMT:SUGGESTION_BENEFIT]',
  '[SAHMT:REVIEW]', '[SAHMT:REVIEW_COMPONENTS]', '[SAHMT:PREVIOUS_VERSION]', '[SAHMT:NEW_VERSION]',
  '[SAHMT:CHANGE_SUMMARY]', '[SAHMT:MATERIAL_EVIDENCE]', '[SAHMT:QUESTION_EVIDENCE]'];
const marked = (item, prefix) => String(item.title || '').startsWith(prefix);
const question = item => item?.questionItem?.question;
const points = item => Number(question(item)?.grading?.pointValue || 0);
const scored = metadata => metadata.items.filter(item => points(item) > 0);
function exactlyOne(items, predicate, code) {
  const found = items.filter(predicate); requireValue(found.length === 1, code); return found[0];
}

/** A data-only plan: no SDK, fetch, tokens, local credentials or mutation API. */
function planTrainingTemplate({audit, formId, hasResponses = null}) {
  requireValue(audit?.schemaVersion === 1 && audit.result?.code === 'TRAINING_MODEL_AUDIT_READY', 'TRAINING_AUDIT_INVALID');
  const source = exactlyOne(audit.snapshots, item => item.formId === formId, 'TRAINING_TARGET_AMBIGUOUS');
  const entry = exactlyOne(audit.targets, item => item.formId === formId, 'TRAINING_MANIFEST_TARGET_AMBIGUOUS');
  const model = audit.model;
  requireValue(model.responderUri === audit.modelUrl && model.formId && model.revisionId && source.revisionId,
    'TRAINING_MODEL_IDENTITY_UNCONFIRMED');
  requireValue(model.settings?.emailCollectionType === 'VERIFIED' && source.settings?.emailCollectionType === 'VERIFIED',
    'TRAINING_VERIFIED_EMAIL_REQUIRED');
  const pages = model.items.filter(item => item.pageBreakItem);
  requireValue(pages.length === 3 && pages[2].title === 'REVISÃO PELO GESTOR', 'TRAINING_MODEL_LAYOUT_CHANGED');
  const modelAck = model.items[0];
  const pageIndex = model.items.findIndex(item => item.itemId === pages[1].itemId);
  const modelSuggestion = model.items[pageIndex + 1];
  requireValue(question(modelAck)?.choiceQuestion?.type === 'RADIO' &&
    question(modelAck).choiceQuestion.options.length === 1 && question(modelSuggestion)?.textQuestion?.paragraph === true,
  'TRAINING_MODEL_FIELDS_CHANGED');
  const isModel = formId === model.formId;
  const ack = isModel ? source.items[0] : exactlyOne(source.items, item => marked(item, '[SAHMT:ACK]'), 'TRAINING_ACK_AMBIGUOUS');
  const suggestion = isModel ? exactlyOne(source.items, item => item.itemId === modelSuggestion.itemId, 'TRAINING_SUGGESTION_AMBIGUOUS')
    : exactlyOne(source.items, item => marked(item, '[SAHMT:SUGGESTION_PROPOSAL]'), 'TRAINING_SUGGESTION_AMBIGUOUS');
  requireValue(points(ack) === 0 && points(suggestion) === 0 && question(ack)?.choiceQuestion?.type === 'RADIO' &&
    question(suggestion)?.textQuestion?.paragraph === true, 'TRAINING_AUXILIARY_QUESTION_INVALID');
  const modelReviewIndex = source.items.findIndex(item => isModel && item.itemId === pages[2].itemId);
  const removed = source.items.filter((item, index) => item.itemId !== ack.itemId && item.itemId !== suggestion.itemId &&
    (item.pageBreakItem || PREFIXES.some(prefix => marked(item, prefix)) || isModel && index >= modelReviewIndex));
  requireValue(removed.every(item => points(item) === 0), 'TRAINING_SCORED_QUESTION_REMOVAL_DENIED');
  const removalIds = new Set(removed.map(item => item.itemId));
  const body = source.items.filter(item => !removalIds.has(item.itemId) && item.itemId !== ack.itemId && item.itemId !== suggestion.itemId);
  const replaceQuestion = (original, template) => ({...copy(original), title:template.title,
    ...(template.description ? {description:template.description} : {description:''}),
    questionItem:{...copy(template.questionItem),question:{...copy(question(template)),questionId:question(original).questionId}}});
  const nextAck = replaceQuestion(ack, modelAck), nextSuggestion = replaceQuestion(suggestion, modelSuggestion);
  const newPage = (role, template) => ({itemId:hash({formId,role,version:2}).slice(0,8),title:template.title,pageBreakItem:{}});
  const quizPage = newPage('QUIZ',pages[0]), suggestionPage = newPage('SUGGESTION',pages[1]);
  requireValue(!source.items.some(item => [quizPage.itemId,suggestionPage.itemId].includes(item.itemId)), 'TRAINING_GENERATED_ITEM_ID_COLLISION');
  const desired = [nextAck,quizPage,...copy(body),suggestionPage,nextSuggestion];
  requireValue(new Set(desired.map(item => item.itemId)).size === desired.length && hash(scored(source)) === hash(scored({items:desired})),
    'TRAINING_QUESTION_BANK_CHANGED');
  const virtual = source.items.map(item => item.itemId), requests = [];
  for (let index = virtual.length - 1; index >= 0; index--) if (removalIds.has(virtual[index])) {
    requests.push({deleteItem:{location:{index}}}); virtual.splice(index,1);
  }
  for (let index = 0; index < desired.length; index++) {
    const item = desired[index], current = virtual.indexOf(item.itemId);
    if (current === -1) {
      // Google assigns IDs to new section headers; retain the existing question IDs.
      const newItem = copy(item); delete newItem.itemId;
      requests.push({createItem:{item:newItem,location:{index}}}); virtual.splice(index,0,item.itemId);
    }
    else if (current !== index) { requests.push({moveItem:{originalLocation:{index:current},newLocation:{index}}}); virtual.splice(index,0,virtual.splice(current,1)[0]); }
    if ([ack.itemId,suggestion.itemId].includes(item.itemId)) requests.push({updateItem:{item:copy(item),location:{index},updateMask:'title,description,questionItem'}});
  }
  return {schemaVersion:1,formId,manifestDigest:audit.manifestDigest,beforeRevision:source.revisionId,
    beforeSha256:hash(source),sourceEntry:copy(entry),expectedItems:desired,questionBankSha256:hash(scored(source)),
    scoredQuestions:scored(source).length,maxTestScore:scored(source).reduce((sum,item) => sum + points(item),0),
    reviewDestination:'APP_DESIGNATED_MANAGER_ONLY',participantSections:3,
    mapping:{acknowledgement:{itemId:ack.itemId,questionId:question(ack).questionId,affirmativeValue:question(modelAck).choiceQuestion.options[0].value},
      suggestionText:{itemId:suggestion.itemId,questionId:question(suggestion).questionId}},
    responsePresence:hasResponses,applicationBlocked:hasResponses !== false,
    blockCode:hasResponses === true ? 'TRAINING_HISTORY_REQUIRES_PRESERVED_ORIGINAL' : hasResponses === false ? null : 'TRAINING_RESPONSE_PRESENCE_REQUIRED',
    batchUpdate:{writeControl:{requiredRevisionId:source.revisionId},requests}};
}

function verifyTrainingTemplateReadback(plan, metadata) {
  requireValue(metadata?.formId === plan.formId && metadata.settings?.emailCollectionType === 'VERIFIED', 'TRAINING_READBACK_IDENTITY_MISMATCH');
  requireValue(hash(scored(metadata)) === plan.questionBankSha256, 'TRAINING_READBACK_QUESTION_BANK_CHANGED');
  requireValue(metadata.items.every(item => typeof item.itemId === 'string' && item.itemId.length > 0) &&
    new Set(metadata.items.map(item => item.itemId)).size === metadata.items.length, 'TRAINING_READBACK_ITEM_ID_INVALID');
  const strip = items => items.map(item => ({id:item.pageBreakItem ? 'SERVER_ASSIGNED_PAGE' : item.itemId,title:item.title,questionId:question(item)?.questionId,page:!!item.pageBreakItem}));
  requireValue(hash(strip(metadata.items)) === hash(strip(plan.expectedItems)), 'TRAINING_READBACK_LAYOUT_MISMATCH');
  for (const [role,mapping] of Object.entries(plan.mapping)) {
    const actual = metadata.items.find(item => item.itemId === mapping.itemId);
    requireValue(question(actual)?.questionId === mapping.questionId, 'TRAINING_READBACK_MAPPING_MISMATCH');
    if (role === 'acknowledgement') requireValue(JSON.stringify(question(actual).choiceQuestion) === JSON.stringify(question(plan.expectedItems[0]).choiceQuestion), 'TRAINING_READBACK_ACK_MISMATCH');
    else requireValue(question(actual)?.textQuestion?.paragraph === true, 'TRAINING_READBACK_SUGGESTION_MISMATCH');
  }
  return {code:'TRAINING_MODEL_READBACK_OK',scoredQuestions:plan.scoredQuestions,participantSections:3,reviewDestination:plan.reviewDestination};
}

return Object.freeze({plan:planTrainingTemplate,verify:verifyTrainingTemplateReadback});
})();
