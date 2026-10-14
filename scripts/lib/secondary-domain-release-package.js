/** Local release manifest only. Never executes deployments or deletions. */
export const managementDomainCollections=Object.freeze([
 'managementAreas','activities','activityInteractions','activityScoreReviews','indicators','indicatorMeasurements',
 'actionPlans','actionPlanItems','documents','scopedDocuments','equipment','equipmentEvents','maintenanceRecords',
 'scoringRules','scores','learningActivities','learningActivityReceipts','trainings','trainingProgress','trainingReceipts','trainingCompletions'
]);
export function buildSecondaryDomainReleasePackage(indexes) {
 if(!indexes||!Array.isArray(indexes.indexes)||!Array.isArray(indexes.fieldOverrides))throw Error('RELEASE_INDEX_SCHEMA_INVALID');
 const selected=name=>managementDomainCollections.includes(name)||/^evaluation[A-Z]/.test(name);
 const candidate={indexes:indexes.indexes.filter(row=>selected(row.collectionGroup)||(row.collectionGroup==='notifications'&&row.fields.some(f=>f.fieldPath==='audienceType'))),fieldOverrides:indexes.fieldOverrides.filter(row=>selected(row.collectionGroup))};
 return {indexes:candidate,manifest:{schemaVersion:1,mode:'LOCAL_PREPARATION_ONLY',deploymentPerformed:false,
  projects:{identity:'sahmt-17a16',management:'sahmt-gestao-5ae66',occurrences:'indicadores---sahmt'},
  prerequisites:['FRESH_DOCUMENT_COMPARISON','EXECUTOR_PERMISSIONS_VERIFIED','REMOTE_RULES_AND_INDEXES_BACKED_UP','EXISTING_INDEXES_MERGED_NOT_REPLACED','OLD_DOMAIN_WRITERS_QUIESCED','PRIVATE_BINDINGS_VERIFIED'],
  worker:{MANAGEMENT_DOMAIN_ENABLED:false,OCCURRENCE_SCORING_ENABLED:false},
  pwa:{VITE_MANAGEMENT_DATA_PROJECT:'FA',VITE_EVALUATION_DATA_PROJECT:'FA',VITE_OCCURRENCE_SCORING_ENABLED:false},
  activationValues:{worker:{MANAGEMENT_DOMAIN_ENABLED:true},pwa:{VITE_MANAGEMENT_DATA_PROJECT:'FB',VITE_EVALUATION_DATA_PROJECT:'FB'},appsScript:{evaluationProject:'sahmt-gestao-5ae66',configuration:'CODE_CUTOVER'},marker:{path:'managementRuntime/domainCutover',schemaVersion:1,projectId:'sahmt-gestao-5ae66',managementEnabled:true,evaluationEnabled:true}},
  firstLoginSpecial:false,secretValuesIncluded:false,
  retirement:{enabled:false,excludedCollections:['users','documentAccessEmails','managementAreas','notifications','notificationGroups','auditLogs'],
   blockers:['AREA_NOTIFICATIONS_FB_ROUTING_DEPLOYED','FRESH_POST_CUTOVER_PARITY_REQUIRED','OFFLINE_SOURCE_ACTIONS_REQUIRE_RECONCILIATION'],
   policy:'Exact backed-up paths only; equivalent destination; unchanged source updateTime; never delete shared operational history.'},
  sequence:['BACK_UP_REMOTE_CONFIGURATION_AND_DATA','COMPARE_CURRENT_DOCUMENTS_AND_PENDING_ACTIONS','INSTALL_INACTIVE_GATEWAY_AND_OPERATIONAL_CODE','MERGE_REQUIRED_FB_INDEXES','INSTALL_REVIEWED_FB_RULES','UPDATE_WORKER_WITH_DOMAIN_FLAGS_OFF','QUIESCE_FA_DOMAIN_WRITERS_AND_COPY_FINAL_DELTA','ENABLE_FB_MARKER_AND_SERVER_ROUTING','BUILD_PWA_WITH_EXPLICIT_FB_TARGETS','VERIFY_ADMIN_AND_COMMON_USER_BUSINESS_ACTIONS','ENABLE_VERIFIED_FC_SCORING_DELIVERY','RECONCILE_SOURCES_BEFORE_SEPARATE_FA_RETIREMENT'],
  rollback:{beforeNewFbWrites:'Restore backed-up code and flags. Preserve all data.',afterNewFbWrites:'Disable affected writes and notifications; preserve receipts and pending actions; reconcile FB changes before any return to FA.'}
 }};
}
