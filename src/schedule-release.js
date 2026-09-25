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
