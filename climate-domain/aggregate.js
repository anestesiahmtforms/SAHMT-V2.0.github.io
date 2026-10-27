import {COMMON, DIMENSIONS, MODULES, VERSION, CYCLE} from './schema.js';
export const MIN_GROUP = 5;
// A single immutable snapshot per closed cycle. No role filters or administrative module.
// Suppress on the number of PEOPLE with numeric answers, including complementary suppression.
export function summarize(rows, ids, total) {
  let favorable = 0, denominator = 0;
  for (const id of ids) {
    const values = rows.map(row => row.answers[id]).filter(Number.isInteger);
    if (values.length < MIN_GROUP || (total - values.length > 0 && total - values.length < MIN_GROUP)) return null;
    denominator += values.length;
    favorable += values.filter(value => value >= 4).length;
  }
  return {numerator: favorable, denominator, favorable: Math.round(1000 * favorable / denominator) / 10};
}
export function aggregate(rows, cycle = CYCLE) {
  if (rows.length < MIN_GROUP) throw Error('INSUFFICIENT_RESPONDENTS');
  const ids = COMMON.map(q => q.id);
  const moduleRespondents = rows.filter(row => [...MODULES.resident, ...MODULES.preceptor].some(q => Object.hasOwn(row.answers, q.id))).length;
  const residual = rows.length - moduleRespondents;
  const releaseModules = residual === 0 || residual >= MIN_GROUP;
  return {
    survey_cycle: cycle, survey_version: VERSION, submissions: rows.length,
    participation: {numerator: rows.length, denominator: 60, percent: Math.round(rows.length / 60 * 1000) / 10, uniquePeopleVerified: false},
    general: summarize(rows, ids, rows.length),
    dimensions: DIMENSIONS.map(([label], i) => ({label, score: summarize(rows, ids.slice(i * 4, i * 4 + 4), rows.length)})),
    psychologicalSafety: summarize(rows, ids.slice(12, 16), rows.length),
    safetyCulture: summarize(rows, [13, 14, 15, 24, 25, 26, 27].map(i => ids[i]), rows.length),
    contribution: summarize(rows, ['Q30'], rows.length), improvementTrust: summarize(rows, ['Q32'], rows.length),
    modules: Object.fromEntries(['resident', 'preceptor'].map(key => {
      const selected = rows.filter(row => MODULES[key].some(q => Object.hasOwn(row.answers, q.id)));
      // Prevent deduction of a small complementary group from the total.
      const safe = releaseModules && selected.length >= MIN_GROUP && (rows.length === selected.length || rows.length - selected.length >= MIN_GROUP);
      return [key, safe ? summarize(selected, MODULES[key].map(q => q.id), selected.length) : null];
    }))
  };
}
