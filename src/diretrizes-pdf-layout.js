export const PDF_ZOOM_STEPS = Object.freeze([1, 1.25, 1.5, 2, 2.5, 3]);
export const PDF_MAX_CANVAS_PIXELS = 4000000;
const MAX_DIMENSION = 4096;

/** CSS page size and backing resolution are independent on Retina displays. */
export function pdfPageLayout({width, height, availableWidth, zoom = 1, devicePixelRatio = 1}) {
  if (![width, height, availableWidth].every(n => Number.isFinite(n) && n > 0) || !PDF_ZOOM_STEPS.includes(zoom)) throw Error('READING_PDF_INVALID');
  const scale = Math.min(availableWidth / width, 2) * zoom;
  const cssWidth = width * scale, cssHeight = height * scale;
  if (![scale, cssWidth, cssHeight].every(n => Number.isFinite(n) && n > 0)) throw Error('READING_PDF_INVALID');
  const density = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? Math.min(3, Math.max(1, devicePixelRatio)) : 1;
  const outputScale = Math.min(density, Math.sqrt(PDF_MAX_CANVAS_PIXELS / (cssWidth * cssHeight)), MAX_DIMENSION / cssWidth, MAX_DIMENSION / cssHeight);
  if (!Number.isFinite(outputScale) || outputScale <= 0) throw Error('READING_PDF_INVALID');
  return {scale, outputScale, cssWidth, cssHeight,
    pixelWidth: Math.max(1, Math.floor(cssWidth * outputScale)), pixelHeight: Math.max(1, Math.floor(cssHeight * outputScale))};
}
