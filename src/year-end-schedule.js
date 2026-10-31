export const YEAR_END_CYCLE = '2026-2027';
export const YEAR_END_PROJECT = 'outros-48120';
export const YEAR_END_COLLECTION = 'yearEndSchedules';
export const YEAR_END_SUMMARY_VERSION = 2;
export const YEAR_END_SHIFT_ONLY_SIGLAS = Object.freeze(['FR','AD','L2','LE']);
export const YEAR_END_SHIFTS = Object.freeze([
  {id:'natal',label:'Plantão Natal',dates:'24 e 25/12/2026'},
  {id:'reveillon',label:'Plantão Réveillon',dates:'31/12/2026 e 01/01/2027'},
  {id:'carnaval',label:'Plantão Carnaval',dates:'06, 07, 08 e 09/02/2027'}
]);
export const YEAR_END_GROUPS = Object.freeze([
  {id:'natal',label:'Grupo Natal',dates:'26 a 29/12/2026',detail:'Até 13h30 do dia 29/12'},
  {id:'reveillon',label:'Grupo Réveillon',dates:'29/12/2026, após 13h30',detail:'30/12/2026 · E nos dias 02 e 03/01/2027'}
]);
export const yearEndError = code => Object.assign(Error(code),{code});

export function validateYearEndChoices(input,{requireGroup=true}={}) {
  if (!input || Array.isArray(input) || typeof input !== 'object' ||
      Object.keys(input).length !== 2 || !YEAR_END_SHIFTS.some(o=>o.id===input.plantao) ||
      (requireGroup?!YEAR_END_GROUPS.some(o=>o.id===input.grupo):input.grupo!==null)) throw yearEndError('YEAR_END_INVALID_CHOICES');
  return {plantao:input.plantao,grupo:input.grupo};
}

export function yearEndParticipation(policy,uid) {
  const siglas=policy?.siglasByUid;
  if(policy?.schemaVersion!==1||policy.cycle!==YEAR_END_CYCLE||!siglas||typeof siglas!=='object'||Array.isArray(siglas))throw yearEndError('YEAR_END_POLICY_UNAVAILABLE');
  return yearEndOwnParticipation({schemaVersion:policy.schemaVersion,cycle:policy.cycle,sigla:siglas[uid]});
}

export function yearEndOwnParticipation(config) {
  if(config?.schemaVersion!==1||config.cycle!==YEAR_END_CYCLE)throw yearEndError('YEAR_END_POLICY_UNAVAILABLE');
  const sigla=config.sigla;
  if(typeof sigla!=='string'||!/^(?:[A-Z]{2}|L2)$/.test(sigla))throw yearEndError('YEAR_END_INELIGIBLE');
  return {sigla,requireGroup:!YEAR_END_SHIFT_ONLY_SIGLAS.includes(sigla)};
}

export function canUseYearEndSchedule(session) {
  const user=session?.user,profile=session?.profile;
  const blocked=['RESIDENTE_1','RESIDENTE_2','RESIDENTE_3','SUBSTITUTO'];
  if(profile?.memberCategories?.some?.(id=>blocked.includes(id))||/resident|substitut/i.test(profile?.role||''))return false;
  return Boolean(session?.status==='signed-in' && user?.uid && user.emailVerified===true &&
    profile?.uid===user.uid && profile.active===true && profile.access===true &&
    typeof user.email==='string' && user.email.trim() &&
    String(profile.email||'').trim().toLowerCase()===user.email.trim().toLowerCase());
}

export const sortYearEndRegistrations = rows => [...rows].sort((a,b)=>a.position-b.position);

export function confirmedYearEndRegistration(record,{uid,sigla,requireGroup}={}) {
  if(!uid||record?.uid!==uid||record.sigla!==sigla||!Number.isSafeInteger(record.position)||record.position<1)return false;
  try{validateYearEndChoices({plantao:record.plantao,grupo:record.grupo},{requireGroup});return true;}
  catch{return false;}
}

export function yearEndAdministrator(profile,assignment) {
  const categories=assignment?.memberCategories;
  return Boolean(profile?.active===true&&profile.access===true&&
    (profile.role==='administrador_app'||profile.permissions?.admin===true||profile.permissions?.usersManage===true)&&
    Array.isArray(categories)&&new Set(categories).size===categories.length&&
    categories.some(id=>['EFETIVO','ADMINISTRADOR'].includes(id))&&
    categories.every(id=>['EFETIVO','ADMINISTRADOR','GESTOR'].includes(id)));
}

export function yearEndMessage(error) {
  const code=error?.code||error?.message;
  return ({
    YEAR_END_INVALID_CHOICES:'Confira as escolhas obrigatórias indicadas no formulário.',
    YEAR_END_INELIGIBLE:'A Escala Final de Ano é exclusiva da equipe efetiva. Residentes e substitutos não participam deste módulo.',
    YEAR_END_POLICY_UNAVAILABLE:'A configuração de participação precisa ser conferida pela gestão.',
    YEAR_END_SUMMARY_UNAVAILABLE:'Os totais estão sendo preparados. Tente novamente em instantes.',
    YEAR_END_SESSION_CHANGED:'Sua sessão mudou. Volte e reabra a escala com a mesma conta do app.',
    YEAR_END_AUTH_REQUIRED:'Conecte a escala com a mesma conta Google usada no app para continuar.',
    YEAR_END_FORBIDDEN:'Seu perfil precisa estar ativo e liberado no cadastro institucional.',
    YEAR_END_CORRUPT_ORDER:'A ordem de inscrições precisa ser conferida pela gestão.',
    'permission-denied':'O acesso à escala precisa ser liberado pela administração.',
    unavailable:'Não foi possível conectar. Confira a internet e tente novamente.',
    'failed-precondition':'A escala precisa de uma revisão de configuração pela administração.'
  })[code] || 'Não foi possível confirmar a operação. Tente novamente.';
}
