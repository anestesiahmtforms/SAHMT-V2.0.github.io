import {mountPerformanceModule} from '../../src/performance-ui.js';
window.trainingLive={stops:0,metadataCalls:0};const state=window.trainingLive;
const activity=version=>({id:'training',title:'Treinamento fictício',active:true,status:'READY',version,creditScopeId:'matter',responderUrl:'https://forms.example.invalid/training',modalities:{test:true}});
const services={
 async listEvaluationActivities(){return [activity(1)];},async listEvaluationAssignments(){return [];},
 watchEvaluation({onData}){state.evaluation=onData;setTimeout(()=>onData({fromCache:false,pendingWrites:false,participations:[{uid:'person',activityId:'training',creditScopeId:'matter',version:1,training:{complete:true,score:5,maxScore:10}}],awards:[],ledger:[]}),0);return ()=>state.stops++;},
 watchTrainingParticipation({onData,includeParticipations}){state.metadataCalls++;state.includeParticipations=includeParticipations;state.metadata=onData;setTimeout(()=>onData({confirmed:true,activities:[activity(1)]}),0);return ()=>state.stops++;}
};
state.cleanup=mountPerformanceModule(document.querySelector('#host'),{uid:'person',profile:{active:true,access:true},services});
state.revise=()=>state.metadata({confirmed:true,activities:[activity(2)]});
state.invalidate=()=>state.metadata({confirmed:true,activities:[{...activity(2),trainingRevisionRequired:true,status:'CONFIGURATION_PENDING'}]});
state.cache=()=>state.metadata({confirmed:false,activities:[activity(1)]});
window.trainingLiveReady=true;
