import {getFunctions, httpsCallable} from 'firebase/functions';
import {app, appCheckReady} from './firebase-app.js';

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível abrir a foto.')); };
    image.src = url;
  });
}

function encodeJpeg(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function imageDataUrl(canvas, maxBytes) {
  for (const quality of [.82, .72, .62, .52, .42]) {
    const blob = await encodeJpeg(canvas, quality);
    if (blob && blob.size <= maxBytes) {
      return `data:image/jpeg;base64,${await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      })}`;
    }
  }
  return '';
}

export async function extractLabelWithAi(file) {
  if (!app) throw new Error('O Firebase não está configurado neste app.');
  if (!(file instanceof Blob) || !/^image\/(?:jpeg|png|webp)$/i.test(file.type) || file.size > 12 * 1024 * 1024) {
    throw new Error('Escolha uma imagem JPG, PNG ou WebP de até 12 MB.');
  }
  const appCheck = await appCheckReady;
  if (!appCheck) throw new Error('A leitura por IA aguarda a configuração do App Check para este domínio. Você pode continuar pelo registro manual.');
  const image = await loadImage(file);
  const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', {willReadFrequently: false});
  if (!context) throw new Error('Não foi possível preparar a foto.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const imageData = await imageDataUrl(canvas, 440 * 1024);
  if (!imageData) throw new Error('A foto não pôde ser compactada. Capture novamente com mais luz.');
  const cropTop = Math.floor(canvas.height * .58);
  const cropHeight = canvas.height - cropTop;
  const cropWidth = Math.floor(canvas.width / 2);
  const numericImageDataUrls = [];
  for (const left of [0, cropWidth]) {
    const crop = document.createElement('canvas');
    crop.width = Math.max(1, left ? canvas.width - cropWidth : cropWidth);
    crop.height = Math.max(1, cropHeight);
    crop.getContext('2d')?.drawImage(canvas, left, cropTop, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const data = await imageDataUrl(crop, 55 * 1024);
    crop.width = 0;
    crop.height = 0;
    if (data) numericImageDataUrls.push(data);
  }
  canvas.width = 0;
  canvas.height = 0;
  const functions = getFunctions(app, 'southamerica-east1');
  const readLabelImage = httpsCallable(functions, 'readLabelImage', {timeout: 60000});
  const response = await readLabelImage({imageDataUrl: imageData, numericImageDataUrls});
  return response.data;
}
