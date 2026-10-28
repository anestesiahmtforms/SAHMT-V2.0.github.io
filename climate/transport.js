import {callParticipantSurvey} from './participant-session.js';
import {validateSubmission} from '../climate-domain/schema.js';
export const FE_PROJECT = 'outros-48120';
const database = `projects/${FE_PROJECT}/databases/(default)`;
export const COMMIT_URL = `https://firestore.googleapis.com/v1/${database}/documents:commit`;
const value = v => typeof v === 'number' ? {integerValue: String(v)} : {stringValue: v};
const map = object => ({mapValue:{fields:Object.fromEntries(Object.entries(object).map(([key,v])=>[key,value(v)]))}});
export function commitBody(payload, commentToken) {
  const input = validateSubmission(payload);
  if(!/^[a-f0-9]{32}$/.test(commentToken))throw Error('INVALID_COMMENT_TOKEN');
  const writes = [{update:{name:`${database}/documents/climateResponses/${input.submission_id}`,fields:{survey_cycle:value(input.survey_cycle),survey_version:value(input.survey_version),answers:map(input.answers)}}}];
  if(input.group)writes[0].update.fields.group=value(input.group);
  if(Object.keys(input.comments).length)writes.push({update:{name:`${database}/documents/climateComments/${commentToken}`,fields:{survey_cycle:value(input.survey_cycle),comments:map(input.comments)}}});
  return {writes};
}
export async function sendSubmission(payload,commentToken,signal){return callParticipantSurvey({action:'SUBMIT',input:{...validateSubmission(payload),consent:true},signal});}
