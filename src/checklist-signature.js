import {createChecklistSignatureRequest, previewChecklistSignatureRequest} from './data.js';

export function getChecklistSignaturePreview({day, stations, records, uid}) {
  return previewChecklistSignatureRequest({day, stations, records, uid});
}

export function signChecklistReport({day, revision, declaration, uid, signerName, rotationSigla, rotationPosition}) {
  return createChecklistSignatureRequest({day, revision, declaration, uid, signerName, rotationSigla, rotationPosition});
}
