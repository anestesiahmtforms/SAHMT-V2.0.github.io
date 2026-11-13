import {assertFolderReadable} from '../server/folder-read-policy.js';
import {parseTrainingFolderAccess} from '../src/html-training-folders.js';
import {fiError} from './store.js';

const mapped = {
 FB: {documents:'gestao',scopedDocuments:'gestao',activities:'gestao',trainings:'gestao/area-gestao-de-documentos',learningActivities:'gestao/area-gestao-de-documentos'},
 FC: {qmentumAccess:'registros/qmentum',qmentumConfig:'registros/qmentum',qmentumUnits:'registros/qmentum'},
 FF: {communicationMessages:'comunicacao'},
 FG: {checklists:'operacao/checklist'},
 FH: {labels:'operacao/etiquetas'},
 FJ: {contacts:'operacao/pessoas',events:'operacao/eventos'}
};
const aggregateFb = ['documents','scopedDocuments','activities','trainings','learningActivities'];
const fingerprint = policy => policy===null ? null : JSON.stringify([policy.version??policy.revision,[...policy.disabled].sort()]);

export function createFiFolderReader({readPolicy,readTrainingPolicy,administrator=false}) {
 let policyPromise,trainingPromise;
 async function loadPolicy() {
  const policy=await readPolicy();
  if(policy!==null)assertFolderReadable(policy,'policy-probe');
  return policy;
 }
 async function loadTraining() {
  const policy=await readTrainingPolicy();
  if(policy===null)return null;
  const value=parseTrainingFolderAccess(policy);
  if(!value)throw fiError('FI_FOLDER_POLICY_INVALID');
  return value;
 }
 const policy=()=>policyPromise??=loadPolicy();
 const training=()=>trainingPromise??=loadTraining();
 async function assertOpen(folder) {
  if(administrator)return null;
  const value=await policy();
  if(value!==null)assertFolderReadable(value,folder);
  return value;
 }
 async function check(alias,collection) {
  const base=collection.split('/')[0];
  if(alias==='FB'&&['htmlTrainings','htmlTrainingContent'].includes(base))return checkHtmlLibrary();
  if(alias==='FJ'&&base==='scheduleDays'){
   for(const folder of ['operacao/escala','operacao/eventos','operacao/escala/ferias'])await assertOpen(folder);
   return;
  }
  const folder=mapped[alias]?.[base];
  if(!folder)return;
  const value=await assertOpen(folder);
  if(alias==='FB'&&aggregateFb.includes(base)){
   if(value?.disabled.some(id=>id.startsWith('gestao/')))throw fiError('FI_FOLDER_DISABLED',403);
   if(['trainings','learningActivities'].includes(base)&&(await training())?.disabled.length)throw fiError('FI_FOLDER_DISABLED',403);
  }
 }
 async function checkHtmlLibrary() {
  const value=await assertOpen('gestao/area-gestao-de-documentos');
  if(value?.disabled.some(id=>id.startsWith('gestao/'))||(await training())?.disabled.length)throw fiError('FI_FOLDER_DISABLED',403);
 }
 async function checkMonthly() {
  for(const folder of ['registros/qmentum','gestao'])await assertOpen(folder);
  if((!administrator&&(await policy())?.disabled.some(id=>id.startsWith('gestao/')))||(await training())?.disabled.length)throw fiError('FI_FOLDER_DISABLED',403);
 }
 return {
  start:()=>administrator?null:policy(),
  assertOpen,
  checkHtmlLibrary,
  checkMonthly,
  async recheck() {
   if(policyPromise&&fingerprint(await policy())!==fingerprint(await loadPolicy()))throw fiError('FI_FOLDER_POLICY_CHANGED',409);
   if(trainingPromise&&fingerprint(await training())!==fingerprint(await loadTraining()))throw fiError('FI_FOLDER_POLICY_CHANGED',409);
  },
  wrap(stores){
   return Object.fromEntries(Object.entries(stores).map(([alias,store])=>[alias,{
    async get(collection,...args){await check(alias,collection);return store.get(collection,...args);},
    async list(collection,...args){await check(alias,collection);return store.list(collection,...args);},
    async getMany(keys,...args){for(const collection of new Set(keys.map(([collection])=>collection)))await check(alias,collection);return store.getMany(keys,...args);}
   }]));
  }
 };
}
