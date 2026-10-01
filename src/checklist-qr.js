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
  const hints = new Map();
  if (ZXing.DecodeHintType?.TRY_HARDER != null) hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  const source = new ZXing.RGBLuminanceSource(luminance, width, height);
  const binarizers = [ZXing.HybridBinarizer, ZXing.GlobalHistogramBinarizer].filter(Boolean);
  for (const Binarizer of binarizers) {
    try {
      const bitmap = new ZXing.BinaryBitmap(new Binarizer(source));
      const value = new ZXing.QRCodeReader().decode(bitmap, hints).getText();
      if (value) return value;
    } catch { /* A próxima estratégia usa os mesmos pixels da janela visível. */ }
  }
  // Low-contrast labels need a wider luminance range before thresholding.
  let minimum = 255, maximum = 0;
  for (const value of luminance) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
  const range = maximum - minimum;
  if (range >= 8 && range < 160) {
    const adjusted = Uint8ClampedArray.from(luminance, (value) => (value - minimum) * 255 / range);
    const adjustedSource = new ZXing.RGBLuminanceSource(adjusted, width, height);
    for (const Binarizer of binarizers) {
      try {
        const bitmap = new ZXing.BinaryBitmap(new Binarizer(adjustedSource));
        const value = new ZXing.QRCodeReader().decode(bitmap, hints).getText();
        if (value) return value;
      } catch { /* Still confined to the visible camera window. */ }
    }
  }
  return null;
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

export function createChecklistQrConfirmation({now = () => Date.now(), maxGapMs = 1000, maxMisses = 2} = {}) {
  let previous = '', count = 0, lastSeen = 0, misses = 0;
  return (value, {reset = false} = {}) => {
    const currentTime = now();
    if (reset || currentTime - lastSeen > maxGapMs) { previous = ''; count = 0; misses = 0; }
    const candidate = String(value || '').trim();
    if (!candidate) {
      if (++misses > maxMisses) { previous = ''; count = 0; }
      return null;
    }
    count = candidate && candidate === previous ? count + 1 : candidate ? 1 : 0;
    previous = candidate;
    lastSeen = currentTime;
    misses = 0;
    return count >= 2 ? candidate : null;
  };
}
