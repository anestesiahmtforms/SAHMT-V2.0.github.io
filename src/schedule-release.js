const memberPattern = /^(?:[A-Z]{2}|L2)$/;
const tokenPattern = /^(?:DC|[A-Z]{2}|L2)(?:[/-](?:DC|[A-Z]{2}|L2))*$/;

export function updateScheduleReleaseState(currentSiglas, {sigla, marked, groupSiglas = [], tokenSigla = sigla} = {}) {
  if (!Array.isArray(currentSiglas) || !memberPattern.test(sigla || '') || typeof marked !== 'boolean' ||
      !tokenPattern.test(tokenSigla || '') || !Array.isArray(groupSiglas) || groupSiglas.length > 30 ||
      groupSiglas.some((value) => !memberPattern.test(value))) {
    throw new Error('Marcação de liberação inválida.');
  }
  const next = [...new Set(currentSiglas.filter((value) => typeof value === 'string' && tokenPattern.test(value)))];
  const tokenWasMarked = next.includes(tokenSigla);
  const memberWasMarked = next.includes(sigla);
  if (marked && !memberWasMarked) next.push(sigla);
  if (!marked && memberWasMarked) next.splice(next.indexOf(sigla), 1);
  const members = groupSiglas.length ? groupSiglas : [sigla];
  const tokenShouldBeMarked = members.every((member) => next.includes(member));
  if (tokenShouldBeMarked && !next.includes(tokenSigla)) next.push(tokenSigla);
  if (!tokenShouldBeMarked && next.includes(tokenSigla)) next.splice(next.indexOf(tokenSigla), 1);
  return {siglas: next, changed: memberWasMarked !== marked || tokenShouldBeMarked !== tokenWasMarked};
}

export function updateScheduleReleaseTimes(currentTimes = {}, previousSiglas = [], nextSiglas = [], occurredAt) {
  const times = {};
  for (const sigla of nextSiglas) {
    if (Number.isFinite(currentTimes?.[sigla]) && currentTimes[sigla] > 0) times[sigla] = currentTimes[sigla];
    else if (!previousSiglas.includes(sigla) && Number.isFinite(occurredAt) && occurredAt > 0) times[sigla] = occurredAt;
  }
  return times;
}

export function formatScheduleReleaseTime(value) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Sao_Paulo'}).format(date);
}
