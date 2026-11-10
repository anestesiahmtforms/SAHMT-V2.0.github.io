import {assertFePerformanceReadable,assertFeFolderReadable} from '../worker-fe-surveys/performance-policy.js';
import {createFePerformanceReadHandler,FE_PERFORMANCE_READ_PATH} from './performance-read.js';
import {createTrainingWorker} from '../worker-training/worker.js';
import {createSurveyService} from '../worker-training/survey-service.js';
import {createFirestoreStore} from '../worker-training/firestore.js';
import {feServiceToken} from './auth.js';

const runtimes=new WeakMap();
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
  runtimes.set(env,createSurveyService({profileStore,
   responseStore:createFirestoreStore({projectId:'outros-48120',getAccessToken}),
   checkPerformance:tx=>assertFePerformanceReadable(getAccessToken,tx),checkSurvey:(folder,tx)=>assertFeFolderReadable(folder,getAccessToken,tx),
   reportReaderEmail:env.REPORT_READER_EMAIL}));
 }
 return runtimes.get(env);
}
export function createFeSurveyWorker(options={}){
 const service=createTrainingWorker({buildSurveyService,...options});
 const tokens=new WeakMap();
 const performanceRead=createFePerformanceReadHandler({getAccessToken(env){
  if(!tokens.has(env))tokens.set(env,feServiceToken({credentials:JSON.parse(env.FE_SERVICE_ACCOUNT_JSON)}));
  return tokens.get(env)();
 }});
 return {fetch(request,env,ctx){
  if(new URL(request.url).pathname===FE_PERFORMANCE_READ_PATH)return performanceRead(request,env);
  if(new URL(request.url).pathname!=='/v1/institutional-surveys')return Response.json({code:'SURVEY_ROUTE_UNKNOWN'},{status:404,headers:{'Cache-Control':'no-store'}});
  return service.fetch(request,env,ctx);
 }};
}
export default createFeSurveyWorker();
