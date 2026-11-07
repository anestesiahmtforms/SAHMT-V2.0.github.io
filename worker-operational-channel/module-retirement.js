export const migratedChannelCollection = collection => ['events', 'scheduleReleases'].includes(collection);
export const migratedContinuityKind = kind => ['events', 'eventCatalogs', 'scheduleDays', 'vacations'].includes(kind);
export const retiredChannelCollection = (env, collection) => (env.FI_FJ_MODULES_RETIRED === 'true' && migratedChannelCollection(collection)) || (env.FH_MODULE_RETIRED === 'true' && collection === 'labels') || (env.FG_MODULE_RETIRED === 'true' && collection === 'checklists');
export const retiredContinuityKind = (env, kind) => (env.FI_FJ_MODULES_RETIRED === 'true' && migratedContinuityKind(kind)) || (env.FH_MODULE_RETIRED === 'true' && ['labels','labelStaff'].includes(kind)) || (env.FG_MODULE_RETIRED === 'true' && ['checklists','stations'].includes(kind));
