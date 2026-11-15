import {assertFeFolderReadable} from '../worker-fe-surveys/survey-policy.js';
import {createTrainingWorker} from '../worker-training/worker.js';
import {createSurveyService} from '../worker-training/survey-service.js';
import {createFirestoreStore} from '../worker-training/firestore.js';
import {feServiceToken} from './auth.js';
import {createFeBiosafetyService} from './biosafety-service.js';

const runtimes=new WeakMap(),biosafetyRuntimes=new WeakMap();
function buildFeBiosafetyService(env){
 if(!biosafetyRuntimes.has(env)){
  const getAccessToken=feServiceToken({credentials:JSON.parse(env.FE_SERVICE_ACCOUNT_JSON)});
  const store=createFirestoreStore({projectId:'outros-48120',getAccessToken});
  biosafetyRuntimes.set(env,createFeBiosafetyService({store,checkFolder:(folder,tx)=>assertFeFolderReadable(folder,getAccessToken,tx,'VAC')}));
 }
 return biosafetyRuntimes.get(env);
}
function buildSurveyService(env){
 if(!runtimes.has(env)){
  let credentials;try{credentials=JSON.parse(env.FE_SERVICE_ACCOUNT_JSON);}catch{throw Error('SURVEY_CONFIG_REQUIRED');}
  const getAccessToken=feServiceToken({credentials});
  const profiles=createFirestoreStore({projectId:'sahmt-gestao-5ae66',getAccessToken});
  // FB is consulted only for existing membership; this identity cannot write there.
  const profileStore={get(collection,id){
   if(!['users','userCategories'].includes(collection))throw Error('SURVEY_PROFILE_SCOPE_DENIED');
   return profiles.get(collection,id);
  }};
  const responseStore=createFirestoreStore({projectId:'outros-48120',getAccessToken});
  runtimes.set(env,createSurveyService({profileStore,responseStore,performanceProfileStore:responseStore,
   checkSurvey:(folder,tx)=>assertFeFolderReadable(folder,getAccessToken,tx),
   performanceEnabled:true,checkPerformance:()=>assertFeFolderReadable('desempenho/fe',getAccessToken),
   reportReaderEmail:env.REPORT_READER_EMAIL}));
 }
 return runtimes.get(env);
}
export function createFeSurveyWorker(options={}){
 const service=createTrainingWorker({buildSurveyService,buildFeBiosafetyService,...options});
 return {fetch(request,env,ctx){
  if(!['/v1/institutional-surveys','/v1/biosafety'].includes(new URL(request.url).pathname))return Response.json({code:'SURVEY_ROUTE_UNKNOWN'},{status:404,headers:{'Cache-Control':'no-store'}});
  return service.fetch(request,env,ctx);
 }};
}
export default createFeSurveyWorker();
