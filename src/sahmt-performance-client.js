import {callIndicatorsApi} from './indicators-platform-client.js';

const actions = new Set(['GET_SAHMT_PERFORMANCE','LIST_SAHMT_HISTORY','LIST_SAHMT_PEOPLE','ADD_SAHMT_MANUAL','LIST_SAHMT_MANUAL','CORRECT_SAHMT_MANUAL']);

export function createSahmtPerformanceRequest({uid, isCurrent = () => true, transport = callIndicatorsApi} = {}) {
  const controller = new AbortController();
  const current = () => !controller.signal.aborted && typeof uid === 'string' && Boolean(uid) && isCurrent();
  const request = async (action, input = {}) => {
    if (!current()) throw Error('INDICATOR_SESSION_CHANGED');
    if (!actions.has(action)) throw Error('SAHMT_PERFORMANCE_UNSUPPORTED_ACTION');
    const result = await transport({uid,isCurrent:current,action,input,signal:controller.signal});
    if (!current()) throw Error('INDICATOR_SESSION_CHANGED');
    return result;
  };
  request.dispose = () => controller.abort();
  return request;
}
