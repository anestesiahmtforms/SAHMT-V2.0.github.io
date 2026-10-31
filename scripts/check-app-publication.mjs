import {assertAppPublicationCurrent,validateAppPublication} from './lib/app-publication.js';
const plan=validateAppPublication({schema:1,appVersion:process.env.APP_VERSION,release:Number(process.env.APP_RELEASE),sourceRevision:process.env.GITHUB_SHA});
await assertAppPublicationCurrent({plan,repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN});
console.log('APP_PUBLICATION_DEPLOY_CURRENT '+plan.appVersion+' '+plan.release+' '+plan.sourceRevision);
