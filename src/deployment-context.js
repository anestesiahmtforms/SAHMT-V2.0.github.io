// Fixed at build time. URL parameters and browser storage cannot select a database.
const supplied = typeof __SAHMT_DEPLOYMENT__ === 'undefined' ? {} : __SAHMT_DEPLOYMENT__;
const target = supplied.target === 'FB' ? 'FB' : 'FA';
export const deployment = Object.freeze({
  target,
  projectId: target === 'FB' ? 'sahmt-gestao-5ae66' : 'sahmt-17a16',
  appName: target === 'FB' ? 'sahmt-fb-independent' : 'sahmt-v2',
  localDatabase: target === 'FB' ? 'sahmt-fb-independent-local-v1' : 'sahmt-v2-local',
  generation: target === 'FB' ? 'FB_INDEPENDENT_V1' : 'FA_CONSOLIDATED_V1',
  externalManagementEnabled: supplied.externalManagementEnabled === true,
  faBase: '/SAHMT-V2.0.github.io/',
  fbBase: '/SAHMT-V2.0.github.io/gestao/'
});
