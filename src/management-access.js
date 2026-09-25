export function parseManagementUids(value, {maxItems = 100} = {}) {
  if (typeof value !== 'string' && !Array.isArray(value)) {
    throw new Error('Informe os UIDs Firebase em linhas separadas.');
  }
  const entries = (Array.isArray(value) ? value : value.split(/[\r\n,;]+/))
    .map((entry) => String(entry).trim())
    .filter(Boolean);
  const unique = [...new Set(entries)];
  if (unique.some((uid) => uid.length > 128 || /\s/.test(uid))) {
    throw new Error('Cada UID deve ter até 128 caracteres e não pode conter espaços.');
  }
  if (unique.length > maxItems) {
    throw new Error(`Cada lista pode conter no máximo ${maxItems} UIDs.`);
  }
  return unique;
}
