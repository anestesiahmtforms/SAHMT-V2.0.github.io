/** Self-reported occupational vaccination data. No clinical interpretation. */
export const VACCINES = Object.freeze([
  { id: 'hepatitisB', label: 'Hepatite B' }, { id: 'tetanus', label: 'Tétano' },
  { id: 'mmr', label: 'Tríplice viral' }, { id: 'influenza', label: 'Influenza' },
].map(Object.freeze));
export const VACCINATION_CATEGORIES = Object.freeze(['Equipe', 'Residentes', 'Secretárias', 'Substitutos']);
export const VACCINATION_YEARS = Object.freeze([2026, 2027, 2028]);
export const VACCINATION_STATUSES = Object.freeze([
  { id: 'UPDATED', label: 'Atualizada' }, { id: 'PENDING', label: 'Pendente' },
  { id: 'NOT_ADHERED', label: 'Não aderiu' }, { id: 'UNKNOWN', label: 'Não sabe informar' },
].map(Object.freeze));
export const VACCINATION_DECLARATIONS = Object.freeze([
  { id: 'UP_TO_DATE', label: 'Declaro minha vacinação atualizada' },
  { id: 'NO_PROOF', label: 'Não possuo comprovante disponível' },
  { id: 'WILL_UPDATE', label: 'Pretendo atualizar minha vacinação' },
  { id: 'DECLINED', label: 'Não desejo atualizar minha vacinação neste momento' },
].map(Object.freeze));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const invalid = () => { throw Object.assign(new Error('VAC_INVALID_INPUT'), { code: 'VAC_INVALID_INPUT', status: 400 }); };
const allowedKeys = ['year', 'category', 'awareness', 'truth', 'states', 'declaration', 'notes', 'expectedVersion'];

export function validateVaccinationInput(input) {
  if (!plain(input) || Object.keys(input).some(key => !allowedKeys.includes(key)) || allowedKeys.filter(k => k !== 'notes').some(k => !own(input, k))) invalid();
  if (!VACCINATION_YEARS.includes(input.year) || !VACCINATION_CATEGORIES.includes(input.category) || typeof input.awareness !== 'boolean' || input.truth !== true) invalid();
  if (!plain(input.states) || Object.keys(input.states).length !== VACCINES.length || VACCINES.some(v => !own(input.states, v.id) || !VACCINATION_STATUSES.some(s => s.id === input.states[v.id]))) invalid();
  if (!VACCINATION_DECLARATIONS.some(d => d.id === input.declaration) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion >= Number.MAX_SAFE_INTEGER) invalid();
  if (input.notes !== undefined && typeof input.notes !== 'string') invalid();
  const notes = (input.notes || '').replace(/\r\n?/g, '\n').trim();
  if (notes.length > 1500) invalid();
  return { year: input.year, category: input.category, awareness: input.awareness, truth: true,
    states: Object.fromEntries(VACCINES.map(v => [v.id, input.states[v.id]])), declaration: input.declaration, notes, expectedVersion: input.expectedVersion };
}

export const isVaccinationAdmin = profile => !!profile && (profile.role === 'administrador_app' || profile.permissions?.admin === true);
export const vaccinationProfileCategory = profile => [profile?.category, profile?.memberCategory].find(value => VACCINATION_CATEGORIES.includes(value));
export const isVaccinationParticipant = profile => !!profile && profile.active === true && profile.access === true && !/^anestesiahmtforms(?:[2-5])?@gmail\.com$/i.test(String(profile.email || '').trim());
const fraction = (numerator, denominator) => ({ numerator, denominator, percent: denominator ? numerator * 100 / denominator : null });

/** Denominator policy: currently active, access-enabled registered profiles,
 * excluding the five service-owner accounts. This is a current registry snapshot,
 * not a historical workforce count. Uncategorised nonrespondents remain visible.
 */
export function buildVaccinationReport(participants, records, year) {
  if (!VACCINATION_YEARS.includes(year) || !Array.isArray(participants) || !Array.isArray(records)) invalid();
  const eligible = new Map();
  for (const p of participants) if (isVaccinationParticipant(p) && typeof (p.uid || p.id) === 'string' && (p.uid || p.id)) eligible.set(p.uid || p.id, p);
  const responses = new Map();
  for (const record of records) {
    if (!record || record.year !== year || !eligible.has(record.uid)) continue;
    const previous = responses.get(record.uid);
    if (!previous || (record.version || 0) > (previous.version || 0)) responses.set(record.uid, record);
  }
  const entries = [...eligible].map(([uid, profile]) => ({ record: responses.get(uid), category: vaccinationProfileCategory(profile) || vaccinationProfileCategory(responses.get(uid)) || 'Não informado' }));
  const summarize = rows => {
    const registered = rows.length, respondents = rows.filter(row => row.record).length;
    return { registered, respondents, missingResponses: registered - respondents, participation: fraction(respondents, registered),
      vaccines: VACCINES.map(vaccine => {
        const counts = { UPDATED: 0, PENDING: 0, NOT_ADHERED: 0, UNKNOWN: 0 }; let unreported = 0;
        for (const { record } of rows) {
          const state = record?.states?.[vaccine.id];
          if (own(counts, state)) counts[state]++; else unreported++;
        }
        return { ...vaccine, updated: counts.UPDATED, pending: counts.PENDING, notAdhered: counts.NOT_ADHERED, unknown: counts.UNKNOWN, unreported,
          coverageRegistered: fraction(counts.UPDATED, registered), coverageRespondents: fraction(counts.UPDATED, respondents) };
      }) };
  };
  return { year, eligibilityLabel: 'Cadastro atual: perfis ativos e com acesso, excluídas as cinco contas proprietárias. Categorias ausentes ficam em Não informado.',
    denominatorLabels: { registered: 'Profissionais cadastrados elegíveis', respondents: 'Profissionais que responderam no ano' },
    general: summarize(entries), byGroup: [...VACCINATION_CATEGORIES, 'Não informado'].map(category => ({ category, ...summarize(entries.filter(row => row.category === category)) })) };
}
