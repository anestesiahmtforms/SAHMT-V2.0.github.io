export function createChecklistBannerGate() {
  let generation = 0;
  return {
    begin(context) {
      generation += 1;
      return Object.freeze({...context, generation});
    },
    isCurrent(request, context) {
      return Boolean(request && request.generation === generation &&
        ['day', 'stationId', 'uid', 'route', 'dialogOpen'].every((key) => request[key] === context?.[key]));
    }
  };
}
