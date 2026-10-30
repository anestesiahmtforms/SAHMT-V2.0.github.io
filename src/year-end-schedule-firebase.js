import {getFirestore} from 'firebase/firestore';
import {getGoogleProjectAuth,waitForGoogleProjectSession} from './google-project-auth-runtime.js';
import {createYearEndScheduleRepository} from './year-end-schedule-data.js';
import {yearEndError} from './year-end-schedule.js';

export async function openYearEndScheduleRepository({uid,isCurrent,participantOnly=false}={}) {
  if(!isCurrent() || !await waitForGoogleProjectSession('FE',{isCurrent}) || !isCurrent())
    throw yearEndError('YEAR_END_AUTH_REQUIRED');
  const auth=getGoogleProjectAuth('FE');
  return createYearEndScheduleRepository({db:getFirestore(auth.app),auth,uid,isCurrent,participantOnly});
}
