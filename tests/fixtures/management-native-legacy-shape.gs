/** Minimal public shape fixture. It is not the observed source or a valid producer proof. */
function installChecklistValidationTrigger() { return 'MANUAL_CAPABILITY_PRESENT'; }
function readTrustedChecklistSnapshot_() { return {schema:'MINIMAL_LEGACY_SHAPE'}; }
function validateChecklistSignatureRequest_() { return 'DIRECT_COMMIT_CAPABILITY_SHAPE'; }
function validatePendingChecklistSignatureRequests() { return 'LEGACY_CONSUMER_SHAPE'; }
