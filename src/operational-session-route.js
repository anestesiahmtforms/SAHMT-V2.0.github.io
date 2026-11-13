// A route may use multiple domains; enabling one never starts an exchange.
const consumers = Object.freeze({
  FI: Object.freeze([]),
  FJ: Object.freeze(['schedule', 'events', 'checklist', 'admin', 'people']),
  FH: Object.freeze(['labels', 'admin']),
  FG: Object.freeze(['checklist', 'fg-performance'])
});
/** Recheck the actual route at use time; navigation events can be missed or delayed. */
export function synchronizeOperationalSessionRoute({station,session,readRoute}) {
  const active=Object.hasOwn(consumers,station)&&consumers[station].includes(readRoute());
  void session.setActive(active).catch(()=>{});
  return active;
}
export function bindOperationalSessionRoute({station, session, readRoute, subscribe}) {
  const update = () => synchronizeOperationalSessionRoute({station,session,readRoute});
  const stop = subscribe(update);
  update();
  return stop;
}
