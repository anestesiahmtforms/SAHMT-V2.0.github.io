const MAX_CATALOG_ITEMS = 100;
const MAX_CATALOG_VALUE_LENGTH = 120;

export function parseCatalogValues(value, label) {
  const entries = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
  const values = [];
  const seen = new Set();
  for (const entry of entries) {
    const clean = String(entry || '').trim().replace(/\s+/g, ' ');
    if (!clean) continue;
    if (clean.length > MAX_CATALOG_VALUE_LENGTH) throw new Error(`${label}: cada opção deve ter até ${MAX_CATALOG_VALUE_LENGTH} caracteres.`);
    const key = clean.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(clean);
  }
  if (values.length > MAX_CATALOG_ITEMS) throw new Error(`${label}: limite de ${MAX_CATALOG_ITEMS} opções.`);
  return values;
}

export function validateEventCatalog({payers, creditors} = {}) {
  for (const [label, values] of [['Pagadores', payers], ['Credores', creditors]]) {
    if (!Array.isArray(values) || values.length > MAX_CATALOG_ITEMS || values.some((value) => typeof value !== 'string' || !value.trim() || value.length > MAX_CATALOG_VALUE_LENGTH)) {
      throw new Error(`${label}: catálogo inválido.`);
    }
  }
  return {payers: parseCatalogValues(payers, 'Pagadores'), creditors: parseCatalogValues(creditors, 'Credores')};
}
