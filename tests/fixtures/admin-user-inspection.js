import '../../src/training-state.css';
import {openAdministrativeUserInspection} from '../../src/admin-user-inspection.js';
window.inspectionFixture={actor:'admin-fixture',stops:0,requests:[]};
const state=window.inspectionFixture;
document.querySelector('#inspect').onclick=()=>openAdministrativeUserInspection({actorUid:state.actor,subjectUid:'person-fixture',isCurrent:()=>state.actor==='admin-fixture',permissionLabels:{managementRead:'Consultar Gestão'},services:{
 async readAdministrativeUser(actor,subject){state.requests.push({actor,subject});return {uid:subject,displayName:'Pessoa fictícia',role:'anestesiologista',active:true,access:true,permissions:{managementRead:true},documentGroups:['GENERAL']};},
 async listEvaluationActivities(){return [{id:'training',active:true,status:'READY',title:'Treinamento fictício',version:1,creditScopeId:'matter',eligibleGroups:['GENERAL'],modalities:{test:true}}];},
  watchTrainingParticipation({actorUid,subjectUid,onData}){state.requests.push({actor:actorUid,subject:subjectUid});onData({confirmed:true,activities:[{id:'training',title:'Treinamento fictício',version:1,status:'READY',creditScopeId:'matter',modalities:{test:true}}],participations:[{uid:subjectUid,activityId:'training',creditScopeId:'matter',version:1,training:{complete:true,score:5,maxScore:10}}]});return ()=>{state.stops++;};}
}});
window.inspectionFixtureReady=true;
