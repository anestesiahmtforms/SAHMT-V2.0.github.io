function normalizeQrValue(value) {
  return String(value ?? '').trim();
}

function isoDayOrEmpty(value) {
  const day = normalizeQrValue(value);
  return !day || /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function stationIsInDateRange(station, day) {
  const date = isoDayOrEmpty(day);
  const start = isoDayOrEmpty(station?.start);
  const end = isoDayOrEmpty(station?.end);
  if (!date || date === null || start === null || end === null || (start && end && start > end)) return false;
  return (!start || start <= date) && (!end || end >= date);
}

export function stationIsValidOn(station, day) {
  return station?.active === true && stationIsInDateRange(station, day);
}

export function findStationForQr(stations, qrValue, day, {includeInactive = false} = {}) {
  const scanned = normalizeQrValue(qrValue);
  if (!scanned) return null;
  const matches = stations.filter((station) => (includeInactive ? stationIsInDateRange(station, day) : stationIsValidOn(station, day)) && (
    normalizeQrValue(station.qrCode) === scanned || normalizeQrValue(station.id) === scanned
  ));
  return matches.length === 1 ? matches[0] : null;
}

export function decodeQrImageData(imageData, ZXing) {
  const width = Number(imageData?.width);
  const height = Number(imageData?.height);
  const rgba = imageData?.data;
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 || !rgba || rgba.length !== width * height * 4) {
    throw new Error('A imagem do QR não pôde ser processada.');
  }
  if (!ZXing?.BinaryBitmap || !ZXing?.HybridBinarizer || !ZXing?.RGBLuminanceSource || !ZXing?.QRCodeReader) {
    throw new Error('O leitor QR não está disponível neste aparelho.');
  }
  const luminance = new Uint8ClampedArray(width * height);
  for (let index = 0; index < luminance.length; index++) {
    const pixel = index * 4;
    luminance[index] = (rgba[pixel] + 2 * rgba[pixel + 1] + rgba[pixel + 2]) / 4;
  }
  const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.RGBLuminanceSource(luminance, width, height)));
  try {
    return new ZXing.QRCodeReader().decode(bitmap).getText() || null;
  } catch {
    return null;
  }
}

/** Maps the visible guide to camera pixels with object-fit: cover at center. */
export function checklistQrCrop({videoWidth, videoHeight, videoRect, focusRect}) {
  if (!(videoWidth > 0 && videoHeight > 0 && videoRect?.width > 0 && videoRect?.height > 0 && focusRect?.width > 0 && focusRect?.height > 0)) return null;
  const scale = Math.max(videoRect.width / videoWidth, videoRect.height / videoHeight);
  const offsetX = (videoRect.width - videoWidth * scale) / 2;
  const offsetY = (videoRect.height - videoHeight * scale) / 2;
  const x = Math.max(0, Math.floor((focusRect.left - videoRect.left - offsetX) / scale));
  const y = Math.max(0, Math.floor((focusRect.top - videoRect.top - offsetY) / scale));
  const right = Math.min(videoWidth, Math.ceil((focusRect.left + focusRect.width - videoRect.left - offsetX) / scale));
  const bottom = Math.min(videoHeight, Math.ceil((focusRect.top + focusRect.height - videoRect.top - offsetY) / scale));
  return right > x && bottom > y ? {x, y, width: right - x, height: bottom - y} : null;
}

export function createChecklistQrConfirmation() {
  let previous = '', count = 0;
  return (value) => {
    const candidate = String(value || '').trim();
    count = candidate && candidate === previous ? count + 1 : candidate ? 1 : 0;
    previous = candidate;
    return count >= 2 ? candidate : null;
  };
}
