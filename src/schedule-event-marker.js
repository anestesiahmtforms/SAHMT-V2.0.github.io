export function scheduleEventMarker({scheduleSigla, memberSigla, eventId, delayMultiple}) {
  const delay = Number.isInteger(delayMultiple) && delayMultiple >= 1 && delayMultiple <= 6
    ? `ATRASO:${delayMultiple}:` : '';
  return `EVENTO:${scheduleSigla}:${memberSigla || '-'}:${delay}${eventId}`;
}

export function scheduleDelayFromMarker(marker) {
  const match = /^EVENTO:((?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*):((?:[A-Z]{2}|L2)|-):ATRASO:([1-6]):[A-Z0-9_-]+$/i.exec(marker);
  if (!match) return null;
  return {scheduleSigla: match[1].toUpperCase(), memberSigla: match[2].toUpperCase(), multiple: Number(match[3])};
}
