import {getFirestore} from 'firebase/firestore';
import {getGoogleProjectAuth} from './google-project-auth-runtime.js';

// Reuse the same FC identity and persistence managed by the five-project login.
// Its global sign-out and account-change guards also govern the migrated modules.
export const getIndicatorsAuth = () => getGoogleProjectAuth('FC');
export const getIndicatorsFirestore = () => getFirestore(getIndicatorsAuth().app);
