import {offlineStorageDisabled} from './online-only.js';

// Compatibility boundary for callers that still project a pending/cache state.
// Operational storage is retired: none of these functions opens IndexedDB,
// restores records, or schedules transmission. Legacy data is deleted at boot.
export function requiresSendConfirmation() {return false;}
export async function cacheProfile() {}
export async function readCachedProfile() {return null;}
export async function hasCommittedOperation() {return false;}
export async function writeSafeCache() {}
export async function readSafeCache() {return null;}
export async function readFreshSafeCache() {return null;}
export async function readCachedSchedule() {return null;}
export async function pendingTrainingProgressCount() {return 0;}
export async function listPendingTrainingProgress() {return [];}
export async function updateCachedTrainingProgress() {}
export async function discardCachedTrainingProgress() {}
export async function enqueueOperation() {throw offlineStorageDisabled();}
export async function enqueueOccurrenceSubmission() {throw offlineStorageDisabled();}
export async function listQueuedOperations() {return [];}
export async function nextQueuedAttemptAt() {return null;}
export async function listUnsettledOperations() {return [];}
export async function listAwaitingConfirmationOperations() {return [];}
export async function updateQueuedOperation() {throw offlineStorageDisabled();}
export async function confirmQueuedOperation() {throw offlineStorageDisabled();}
export async function claimQueuedOperationForSend() {throw offlineStorageDisabled();}
export async function removeQueuedOperation() {}
export async function pendingOperationCount() {return 0;}
export async function operationCounts() {return {queued:0,failed:0,conflict:0,awaitingConfirmation:0,sending:0};}
export async function retryFailedOperations() {throw offlineStorageDisabled();}
export async function retryableFailedOperationCount() {return 0;}
export async function retryFailedOperation() {throw offlineStorageDisabled();}
export async function clearUserLocalData() {}
export async function saveOperationalDraft() {}
export async function readOperationalDraft() {return null;}
export async function removeOperationalDraft() {}
export async function listOperationalDrafts() {return [];}
export async function pruneLocalReadCache() {return {removed:0};}
