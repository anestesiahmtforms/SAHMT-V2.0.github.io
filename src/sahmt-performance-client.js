import {callSahmtPerformanceApi} from './sahmt-performance-api.js';
import {isSahmtPerformanceAction} from './sahmt-performance-actions.js';

export function createSahmtPerformanceRequest({uid, isCurrent = () => true, transport = callSahmtPerformanceApi} = {}) {
  const controller = new AbortController();
  const current = () => !controller.signal.aborted && typeof uid === 'string' && Boolean(uid) && isCurrent();
  const request = async (action, input = {}) => {
    if (!current()) throw Error('FK_SESSION_CHANGED');
    if (!isSahmtPerformanceAction(action)) throw Error('SAHMT_PERFORMANCE_UNSUPPORTED_ACTION');
    const result = await transport({uid,isCurrent:current,action,input,signal:controller.signal});
    if (!current()) throw Error('FK_SESSION_CHANGED');
    return result;
  };
  request.dispose = () => controller.abort();
  return request;
}
