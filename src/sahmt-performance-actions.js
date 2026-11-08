const actions=new Set([
 'GET_SAHMT_PERFORMANCE','LIST_SAHMT_HISTORY','LIST_SAHMT_PEOPLE',
 'ADD_SAHMT_MANUAL','CORRECT_SAHMT_MANUAL','LIST_SAHMT_MANUAL'
]);

export const isSahmtPerformanceAction=action=>actions.has(action);
