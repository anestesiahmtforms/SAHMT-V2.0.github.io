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

export function findStationForQr(stations, qrValue, day) {
  const scanned = normalizeQrValue(qrValue);
  if (!scanned) return null;
  const matches = stations.filter((station) => stationIsValidOn(station, day) && (
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
