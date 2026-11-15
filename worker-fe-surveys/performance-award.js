export function performanceActive(runtime, at) {
  const effectiveFrom = typeof runtime?.effectiveFrom === 'number' ? runtime.effectiveFrom : Date.parse(runtime?.effectiveFrom);
  return runtime?.schemaVersion === 1 && runtime.projectId === 'outros-48120' &&
    runtime.enabled === true && Number.isFinite(effectiveFrom) && at >= effectiveFrom;
}

export async function awardFeParticipation(tx, {uid, survey, cycle, at, prefix='fePerformance'}) {
  const runtime = await tx.get('fePerformanceRuntime', 'current');
  if (!performanceActive(runtime, at)) return;
  const key = `${uid}_${survey}_${cycle}`;
  if (await tx.get(prefix+'Awards', key)) return;
  const [summary, reference] = await Promise.all([
    tx.get(prefix+'Summaries', uid), tx.get(prefix+'Reference', 'current')
  ]);
  const total = (summary?.total || 0) + 1;
  tx.create(prefix+'Awards', key, {uid, category:'PERFORMANCE', points:1, survey, cycle, createdAt:at});
  tx.set(prefix+'Summaries', uid, {uid, total, updatedAt:at});
  tx.set(prefix+'Reference', 'current', {
    maxTotal:Math.max(reference?.maxTotal || 0,total),
    eligibleCount:(reference?.eligibleCount || 0)+(summary ? 0 : 1),
    updatedAt:at
  });
}