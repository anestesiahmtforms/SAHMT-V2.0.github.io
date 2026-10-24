import * as firebaseApp from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import {auth} from './firebase-auth.js';
import {deployment} from './deployment-context.js';
import {GOOGLE_PROJECT_CONFIG,googleProjectAuthEnabled} from './google-project-auth-config.js';
import {createGoogleProjectAuthRuntime} from './google-project-auth-adapter.js';
import {googleIdentity} from './google-project-auth-core.js';
let storage;try{storage=globalThis.localStorage;}catch{}
const runtime=createGoogleProjectAuthRuntime({sdk:{...firebaseApp,...firebaseAuth},auth,
  entries:GOOGLE_PROJECT_CONFIG,primary:deployment.target,enabled:googleProjectAuthEnabled,storage,
  requestUri:()=>location.origin+import.meta.env.BASE_URL});
export const googleProjectAuth=runtime.controller;
export const confirmGoogleProjectAccess=runtime.confirm;
export const connectGoogleProjectsFromSignIn=runtime.connectFromPrimarySignIn;
export const reconcileGoogleProjectSessions=runtime.reconcile;
export const assertCanStartPrimarySignIn=runtime.assertCanStartPrimarySignIn;
export const getGoogleProjectAuth=runtime.getTargetAuth;
export const verifyGoogleProjectSession=runtime.verifyTargetSession;
export const maintainGoogleProjectSessions=runtime.maintainSessions;
export const currentGoogleProjectIdentity=()=>googleIdentity(auth.currentUser);
export const googleProjectClientId=GOOGLE_PROJECT_CONFIG.FA.acceptedGoogleClientIds[0];
