import {readFile,writeFile} from 'node:fs/promises';
import {COMMON,MODULES,OPEN,VERSION,CYCLE} from '../climate-domain/schema.js';
const ids=[...COMMON,...Object.values(MODULES).flat()].map(q=>q.id);
const strings=values=>'['+values.map(v=>`'${v}'`).join(', ')+']';
const block=`
    // CLIMATE_FREE_V1: public, schema-validated submission; no raw client reads.
    function climateOpen() {
      return exists(/databases/$(database)/documents/climateCycles/${CYCLE}) &&
        get(/databases/$(database)/documents/climateCycles/${CYCLE}).data.status == 'open';
    }
    function climateAnswer(v) { return v == 'NA' || (v is int && v >= 1 && v <= 5); }
    function climateResponse(d) {
      let a = d.get('answers', {});
      return d.keys().hasOnly(['survey_cycle', 'survey_version', 'answers', 'group']) &&
        d.keys().hasAll(['survey_cycle', 'survey_version', 'answers']) &&
        d.survey_cycle == '${CYCLE}' && d.survey_version in ['1.0', '${VERSION}'] && a is map &&
        d.get('group', 'unspecified') in ['resident', 'secretaries', 'team', 'unspecified'] &&
        (d.survey_version != '1.0' || d.get('group', 'unspecified') == 'unspecified') &&
        (d.survey_version == '1.0' || (d.keys().hasAll(['group']) &&
          (!a.keys().hasAny(${strings(MODULES.resident.map(q=>q.id))}) || d.group == 'resident') &&
          (!a.keys().hasAny(${strings(MODULES.preceptor.map(q=>q.id))}) || d.group == 'team') &&
          (!a.keys().hasAny(${strings(MODULES.administrative.map(q=>q.id))}) || d.group == 'secretaries'))) &&
        a.keys().hasOnly(${strings(ids)}) &&
        (${COMMON.map(q=>`a.get('${q.id}', 'NA') is int`).join(' || ')}) &&
        ${ids.map(id=>`climateAnswer(a.get('${id}', 'NA'))`).join(' &&\n        ')} &&
        ${[['resident','preceptor'],['resident','administrative'],['preceptor','administrative']].map(([a,b])=>`!(a.keys().hasAny(${strings(MODULES[a].map(q=>q.id))}) && a.keys().hasAny(${strings(MODULES[b].map(q=>q.id))}))`).join(' &&\n        ')};
    }
    function climateCommentValue(v) { return v is string && v.size() <= 1500; }
    function climateComment(d) {
      let c = d.get('comments', {});
      return d.keys().hasOnly(['survey_cycle', 'comments']) &&
        d.keys().hasAll(['survey_cycle', 'comments']) && d.survey_cycle == '${CYCLE}' &&
        c is map && c.size() > 0 && c.keys().hasOnly(${strings(OPEN.map(q=>q.id))}) &&
        ${OPEN.map(q=>`climateCommentValue(c.get('${q.id}', ''))`).join(' && ')};
    }
    function climateReader() { return request.auth != null && request.auth.token.get('climateReportReader', false) == true; }
    match /climateResponses/{id} {
      allow read, delete: if false;
      allow create: if id.matches('^[a-f0-9]{32}$') && climateOpen() && climateResponse(request.resource.data);
      // Identical retries only. No answer changes; the page retains both random tokens in memory.
      allow update: if id.matches('^[a-f0-9]{32}$') && climateOpen() && climateResponse(request.resource.data) && request.resource.data == resource.data;
    }
    match /climateComments/{id} {
      allow read, delete: if false;
      allow create: if id.matches('^[a-f0-9]{32}$') && climateOpen() && climateComment(request.resource.data);
      allow update: if id.matches('^[a-f0-9]{32}$') && climateOpen() && climateComment(request.resource.data) && request.resource.data == resource.data;
    }
    match /climateCycles/{id} { allow read, write: if false; }
    match /climateReports/{id} { allow read: if climateReader(); allow write: if false; }
    match /climateActionReports/{id} { allow read: if climateReader(); allow write: if false; }
    // END_CLIMATE_FREE_V1
`;
const baseline=await readFile(new URL('../firestore.fe.base.rules',import.meta.url),'utf8');
const anchor='    match /{document=**}';
if(!baseline.includes(anchor)||baseline.includes('CLIMATE_FREE_V1'))throw Error('REVIEW_FE_BASELINE');
await writeFile(new URL('../firestore.climate.rules',import.meta.url),baseline.replace(anchor,()=>block+'\n'+anchor));
