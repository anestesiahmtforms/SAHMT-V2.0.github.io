const FINAL_ARSENAL_ORDER = new Map(['14', '03', '10', '30', '05', '15', '04', '06', '09', '11', '22'].map((suffix, index) => [suffix, index]));

const ARSENAL_FUNCTION_LABELS = new Map([
  ['14', 'Bloco2 sl.1'],
  ['03', 'Bloco2 sl.2'],
  ['10', 'Endoscopia'],
  ['30', 'Hemod sl.1'],
  ['05', 'Hemod sl.2'],
  ['15', 'Ressonância'],
  ['17', 'Sala 14'],
  ['24', 'Sala 13'],
  ['12', 'Sala 12'],
  ['31', 'Sala 11'],
  ['21', 'Sala Híbrida'],
  ['33', 'Sala 10'],
  ['29', 'Sala 09'],
  ['28', 'Sala 08'],
  ['32', 'Sala 17'],
  ['23', 'Sala 16'],
  ['22', 'Sala 07'],
  ['27', 'Sala 06'],
  ['19', 'Sala Robótica'],
  ['16', 'Sala 02'],
  ['13', 'Sala 03'],
  ['20', 'Sala 04'],
  ['25', 'Sala 05']
]);

function stationSuffix(station) {
  const id = String(station?.id || '');
  return /^\d+$/.test(id) ? id.slice(-2) : '';
}

export function checklistArsenalFunction(station) {
  if (typeof station?.functionLabel === 'string') return station.functionLabel;
  return ARSENAL_FUNCTION_LABELS.get(stationSuffix(station)) || '';
}

export function canEditChecklistStationTitle(user, profile) {
  const email = String(user?.email || '').toLowerCase();
  return !!user?.uid && user.emailVerified === true &&
    ['wx2064@gmail.com', 'marcio.henrique82@gmail.com'].includes(email) &&
    profile?.active === true && profile.access === true &&
    (profile.role === 'administrador_app' || profile.permissions?.admin === true || profile.permissions?.checklistManage === true);
}

export function normalizeChecklistStationTitle(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Confira o título do arsenal: use de 1 a 120 caracteres.');
  const title = value.trim().replace(/\s+/g, ' ');
  if (!title || title.length > 120) throw new Error('Confira o título do arsenal: use de 1 a 120 caracteres.');
  return title;
}

function numericStationId(station) {
  const id = String(station?.id || '');
  return /^\d+$/.test(id) ? Number(id) : null;
}

export function sortChecklistStationsForDisplay(stations, recordForStation) {
  return [...stations].sort((left, right) => {
    const leftFinal = FINAL_ARSENAL_ORDER.get(stationSuffix(left));
    const rightFinal = FINAL_ARSENAL_ORDER.get(stationSuffix(right));
    if ((leftFinal !== undefined) !== (rightFinal !== undefined)) return leftFinal !== undefined ? 1 : -1;
    if (leftFinal !== undefined && rightFinal !== undefined && leftFinal !== rightFinal) return leftFinal - rightFinal;
    if (leftFinal === undefined && rightFinal === undefined) {
      const leftGroup = left.active !== true ? 2 : recordForStation(left)?.condition === 'SIM' ? 0 : 1;
      const rightGroup = right.active !== true ? 2 : recordForStation(right)?.condition === 'SIM' ? 0 : 1;
      if (leftGroup !== rightGroup) return leftGroup - rightGroup;
    }
    const leftId = numericStationId(left);
    const rightId = numericStationId(right);
    if (leftId !== null && rightId !== null && leftId !== rightId) return leftId - rightId;
    return Number(left.order || 0) - Number(right.order || 0) || String(left.id || '').localeCompare(String(right.id || ''));
  });
}

export function checklistArsenalButtonLabel(station) {
  return String(station?.name || station?.id || '').replace(/\barsenal\b\s*[:–—-]?\s*/gi, '').trim() || String(station?.id || '');
}

