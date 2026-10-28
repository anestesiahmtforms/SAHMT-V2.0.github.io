import {QUESTIONS,VERSION,CYCLE} from './schema.js';
export function stressRules(){return `
    // STRESS_SURVEY_V1: institutional fatigue index, no client reads of individual answers.
    function stressOpen() { return exists(/databases/$(database)/documents/stressCycles/${CYCLE}) && get(/databases/$(database)/documents/stressCycles/${CYCLE}).data.status == 'open'; }
    function stressValid(d) {
      let a = d.get('answers', {});
      return d.keys().hasOnly(['survey_cycle','survey_version','group','answers','stress_rating']) &&
        d.keys().hasAll(['survey_cycle','survey_version','group','answers']) &&
        d.survey_cycle == '${CYCLE}' && d.survey_version == '${VERSION}' &&
        d.group in ['team','resident','substitute'] && a is map &&
        a.keys().hasOnly([${QUESTIONS.map(q=>`'${q.id}'`).join(',')}]) && a.size() == 30 &&
        ${QUESTIONS.map(q=>`(a.get('${q.id}', -1) is int && a.get('${q.id}', -1) >= 0 && a.get('${q.id}', -1) <= 5)`).join(' &&\n        ')} &&
        (!d.keys().hasAny(['stress_rating']) || (d.stress_rating is int && d.stress_rating >= 0 && d.stress_rating <= 10));
    }
    match /stressResponses/{id} {
      allow read, delete: if false;
      allow create: if id.matches('^[a-f0-9]{32}$') && stressOpen() && stressValid(request.resource.data);
      allow update: if id.matches('^[a-f0-9]{32}$') && stressOpen() && request.resource.data == resource.data;
    }
    match /stressCycles/{id} { allow read, write: if false; }
    match /stressReports/{id} { allow read: if climateReader(); allow write: if false; }
    // END_STRESS_SURVEY_V1
`;}
