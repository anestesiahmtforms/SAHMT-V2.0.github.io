import {callIndicatorsApi} from './indicators-platform-client.js';
import {isSahmtPerformanceAction} from '../worker-indicators/sahmt-performance-actions.js';

export function createSahmtPerformanceRequest({uid, isCurrent = () => true, transport = callIndicatorsApi} = {}) {
  const controller = new AbortController();
  const current = () => !controller.signal.aborted && typeof uid === 'string' && Boolean(uid) && isCurrent();
  const request = async (action, input = {}) => {
    if (!current()) throw Error('INDICATOR_SESSION_CHANGED');
    if (!isSahmtPerformanceAction(action)) throw Error('SAHMT_PERFORMANCE_UNSUPPORTED_ACTION');
    const result = await transport({uid,isCurrent:current,action,input,signal:controller.signal});
    if (!current()) throw Error('INDICATOR_SESSION_CHANGED');
    return result;
  };
  request.dispose = () => controller.abort();
  return request;
}
