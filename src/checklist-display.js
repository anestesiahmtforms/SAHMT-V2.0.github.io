const FINAL_ARSENAL_ORDER = new Map(['14', '03', '10', '30', '05', '15', '04', '06', '09', '11', '22'].map((suffix, index) => [suffix, index]));

const ARSENAL_FUNCTION_LABELS = new Map([
  ['14', 'Bloco2 sl.1'],
  ['03', 'Bloco2 sl.2'],
  ['10', 'Endoscopia'],
  ['30', 'Hemod sl.1'],
  ['05', 'Hemod sl.2'],
  ['15', 'Ressonância']
]);

function stationSuffix(station) {
  const id = String(station?.id || '');
  return /^\d+$/.test(id) ? id.slice(-2) : '';
}

export function checklistArsenalFunction(station) {
  return ARSENAL_FUNCTION_LABELS.get(stationSuffix(station)) || '';
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
