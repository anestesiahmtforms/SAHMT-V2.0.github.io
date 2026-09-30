export function createChecklistReportGate() {
  let generation = 0;
  return {
    begin(context) {
      generation += 1;
      return Object.freeze({...context, generation});
    },
    invalidate() {
      generation += 1;
    },
    isCurrent(request, context) {
      if (!request || request.generation !== generation) return false;
      return ['day', 'mode', 'route', 'uid', 'reportOpen'].every((key) => request[key] === context?.[key]);
    }
  };
}
