// A route may use multiple domains; enabling one never starts an exchange.
const consumers = Object.freeze({
  FI: Object.freeze([]),
  FJ: Object.freeze(['schedule', 'events', 'checklist', 'admin', 'people']),
  FH: Object.freeze(['labels', 'admin']),
  FG: Object.freeze(['checklist', 'fg-performance'])
});
export function bindOperationalSessionRoute({station, session, readRoute, subscribe}) {
  const update = () => {void session.setActive(Object.hasOwn(consumers, station) && consumers[station].includes(readRoute())).catch(() => {});};
  const stop = subscribe(update);
  update();
  return stop;
}
