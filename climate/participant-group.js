import {callParticipantSurvey} from './participant-session.js';
export const identifyInstitutionalGroup=()=>callParticipantSurvey({action:'BOOTSTRAP'});
