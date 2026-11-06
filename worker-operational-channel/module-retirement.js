export const migratedChannelCollection = collection => ['events', 'scheduleReleases'].includes(collection);
export const migratedContinuityKind = kind => ['events', 'eventCatalogs', 'scheduleDays', 'vacations'].includes(kind);
export const retiredChannelCollection = (env, collection) => env.FI_FJ_MODULES_RETIRED === 'true' && migratedChannelCollection(collection);
export const retiredContinuityKind = (env, kind) => env.FI_FJ_MODULES_RETIRED === 'true' && migratedContinuityKind(kind);
