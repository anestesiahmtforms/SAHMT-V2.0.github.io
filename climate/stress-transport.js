import {requestSurveySession} from '../src/survey-session-bridge.js';
import {validateSubmission} from '../stress-domain/schema.js';
export const COMMIT_URL='https://firestore.googleapis.com/v1/projects/outros-48120/databases/(default)/documents:commit';
export function commitBody(payload){const input=validateSubmission(payload),fields={survey_cycle:{stringValue:input.survey_cycle},survey_version:{stringValue:input.survey_version},group:{stringValue:input.group},answers:{mapValue:{fields:Object.fromEntries(Object.entries(input.answers).map(([k,v])=>[k,{integerValue:String(v)}]))}}};if(input.stress_rating!==undefined)fields.stress_rating={integerValue:String(input.stress_rating)};return {writes:[{update:{name:`projects/outros-48120/databases/(default)/documents/stressResponses/${input.submission_id}`,fields}}]};}
export async function send(payload,signal){return requestSurveySession({action:'SUBMIT',input:validateSubmission(payload),signal});}
