const SIGLA_PATTERN = /^(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*$/;

export function normalizeSchedulePositions(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 30) {
    throw new Error('A escala precisa ter de 1 a 30 posições.');
  }
  return values.map((value, index) => {
    const sigla = String(typeof value === 'string' ? value : value?.sigla || '').trim().toUpperCase();
    if (sigla.length > 30 || !SIGLA_PATTERN.test(sigla)) {
      throw new Error(`Confira a sigla da posição ${index + 1}. Use duas letras, L2 ou siglas combinadas com / ou -.`);
    }
    return {position: index + 1, sigla};
  });
}
