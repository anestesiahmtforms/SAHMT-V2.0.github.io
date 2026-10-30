export const YEAR_END_CYCLE = '2026-2027';
export const YEAR_END_PROJECT = 'outros-48120';
export const YEAR_END_COLLECTION = 'yearEndSchedules';
export const YEAR_END_SHIFTS = Object.freeze([
  {id:'natal',label:'Plantão Natal',dates:'24 e 25/12/2026'},
  {id:'reveillon',label:'Plantão Réveillon',dates:'31/12/2026 e 01/01/2027'}
]);
export const YEAR_END_GROUPS = Object.freeze([
  {id:'natal',label:'Grupo Natal',dates:'26 a 29/12/2026',detail:'Até 13h30 do dia 29/12'},
  {id:'reveillon',label:'Grupo Réveillon',dates:'29/12/2026, após 13h30',detail:'E nos dias 02 e 03/01/2027'}
]);
export const yearEndError = code => Object.assign(Error(code),{code});

export function validateYearEndChoices(input) {
  if (!input || Array.isArray(input) || typeof input !== 'object' ||
      Object.keys(input).length !== 2 || !YEAR_END_SHIFTS.some(o=>o.id===input.plantao) ||
      !YEAR_END_GROUPS.some(o=>o.id===input.grupo)) throw yearEndError('YEAR_END_INVALID_CHOICES');
  return {plantao:input.plantao,grupo:input.grupo};
}

export function canUseYearEndSchedule(session) {
  const user=session?.user,profile=session?.profile;
  return Boolean(session?.status==='signed-in' && user?.uid && user.emailVerified===true &&
    profile?.uid===user.uid && profile.active===true && profile.access===true &&
    typeof user.email==='string' && user.email.trim() &&
    String(profile.email||'').trim().toLowerCase()===user.email.trim().toLowerCase());
}

export const sortYearEndRegistrations = rows => [...rows].sort((a,b)=>a.position-b.position);

export function yearEndMessage(error) {
  const code=error?.code||error?.message;
  return ({
    YEAR_END_INVALID_CHOICES:'Escolha um plantão e um grupo de trabalho.',
    YEAR_END_SESSION_CHANGED:'Sua sessão mudou. Volte e reabra a escala com a mesma conta do app.',
    YEAR_END_AUTH_REQUIRED:'Seu acesso precisa ser atualizado. Use ATUALIZAR O APP na página inicial e reabra a escala.',
    YEAR_END_FORBIDDEN:'Seu perfil precisa estar ativo e liberado no cadastro institucional.',
    YEAR_END_PROFILE_NAME:'Seu nome precisa estar preenchido no cadastro institucional.',
    YEAR_END_CORRUPT_ORDER:'A ordem de inscrições precisa ser conferida pela gestão.',
    'permission-denied':'O acesso à escala precisa ser liberado pela administração.',
    unavailable:'Não foi possível conectar. Confira a internet e tente novamente.',
    'failed-precondition':'A escala precisa de uma revisão de configuração pela administração.'
  })[code] || 'Não foi possível confirmar a operação. Tente novamente.';
}
