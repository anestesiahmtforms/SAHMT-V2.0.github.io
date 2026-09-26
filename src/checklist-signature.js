import {createChecklistSignatureRequest, previewChecklistSignatureRequest} from './data.js';

export function getChecklistSignaturePreview({day, stations, records, uid}) {
  return previewChecklistSignatureRequest({day, stations, records, uid});
}

export function signChecklistReport({day, revision, declaration, justification, uid}) {
  return createChecklistSignatureRequest({day, revision, declaration, justification, uid});
}
