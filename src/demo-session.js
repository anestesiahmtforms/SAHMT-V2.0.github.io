import {trainingParticipationState} from './training-participation-state.js';
export const DEMO_MODULES=Object.freeze(['schedule','events','labels','checklist','management','training','notifications','occurrences','people','qmentum','admin']);
export const DEMO_PERSONAS=Object.freeze({common:{uid:'demo-common',name:'Participante de demonstração',role:'Usuário comum'},admin:{uid:'demo-admin',name:'Administrador de demonstração',role:'Administrador'}});
const persona=()=>({records:Object.fromEntries(DEMO_MODULES.map(name=>[name,[]])),attempts:{},awards:{}});
const fresh=()=>({schemaVersion:1,persona:null,versions:{'training-1':1,'training-2':1},users:{common:persona(),admin:persona()}});
const copy=value=>JSON.parse(JSON.stringify(value));
/** No SDK, request, URL, outbox, Drive, Forms or Firebase is imported here. */
export function createDemoSession(){
 let state=fresh();
 const ensure=()=>{if(!Object.hasOwn(DEMO_PERSONAS,state.persona || ''))throw Error('DEMO_LOGIN_REQUIRED');return state.users[state.persona];};
 const admin=()=>{ensure();if(state.persona!=='admin')throw Error('DEMO_ADMIN_REQUIRED');};
 const module=name=>{if(!DEMO_MODULES.includes(name))throw Error('DEMO_MODULE_INVALID');};
 const input=data=>{if(!data||Object.getPrototypeOf(data)!==Object.prototype||Object.values(data).some(value=>!['string','number','boolean'].includes(typeof value))||JSON.stringify(data).length>5000)throw Error('DEMO_INPUT_INVALID');return copy(data);};
 const training=id=>{if(!Object.hasOwn(state.versions,id))throw Error('DEMO_TRAINING_INVALID');return {id,creditScopeId:id,version:state.versions[id],status:'READY',modalities:{test:true}};};
 return {
  login(persona){if(!Object.hasOwn(DEMO_PERSONAS,persona))throw Error('DEMO_PERSONA_INVALID');state.persona=persona;},
  logout(){state.persona=null;},
  reset(){state=fresh();},
  snapshot(){const user=state.persona?ensure():{records:{},attempts:{},awards:{}};return copy({persona:state.persona,profile:DEMO_PERSONAS[state.persona] || null,records:user.records,versions:state.versions,attempts:user.attempts,points:Object.values(user.awards).reduce((sum,value)=>sum+value,0)});},
  record(name,payload){module(name);const user=ensure();if(['admin','notifications'].includes(name))admin();const row={...input(payload),createdAt:new Date().toISOString(),simulated:true};user.records[name]=[row,...(user.records[name] || [])].slice(0,100);return copy(row);},
  attemptTraining(id,{complete,score,maxScore,submitted=true}){
   const activity=training(id),user=ensure();
   if(typeof complete!=='boolean'||!Number.isFinite(score)||!Number.isFinite(maxScore)||maxScore<=0||score<0||score>maxScore)throw Error('DEMO_GRADE_INVALID');
   const scope=id+':'+activity.version,list=user.attempts[scope] || [];
   list.push({complete,score,maxScore,submitted,simulated:true});user.attempts[scope]=list.slice(-100);
   if(submitted&&!Object.hasOwn(user.awards,scope))user.awards[scope]=score;
   return this.trainingState(id);
  },
  trainingState(id){const activity=training(id),user=ensure(),list=user.attempts[id+':'+activity.version] || [],last=list.at(-1);
   return trainingParticipationState(activity,last?[{uid:DEMO_PERSONAS[state.persona].uid,activityId:id,creditScopeId:id,version:activity.version,training:last}]:[],{uid:DEMO_PERSONAS[state.persona].uid});},
  reviseTraining(id){admin();training(id);state.versions[id]++;return state.versions[id];}
 };
}
