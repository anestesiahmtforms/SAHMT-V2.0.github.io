export function actionIndicators(input) {
  const fields = ['due', 'completedOnTime', 'reevaluated', 'effective'];
  if (!input || Object.keys(input).length !== fields.length || !fields.every(key => Number.isSafeInteger(input[key]) && input[key] >= 0 && input[key] <= 10000) || input.completedOnTime > input.due || input.effective > input.reevaluated) throw Error('INVALID_ACTION_COUNTS');
  const metric = (numerator, denominator) => ({numerator, denominator, percent: denominator ? Math.round(numerator / denominator * 1000) / 10 : null});
  return {onTime: metric(input.completedOnTime, input.due), effectiveness: metric(input.effective, input.reevaluated)};
}
