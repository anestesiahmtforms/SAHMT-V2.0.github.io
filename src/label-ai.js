import {auth} from './firebase-auth.js';
import {app, appCheckReady} from './firebase-app.js';

const workerEndpoint = import.meta.env.VITE_LABEL_AI_ENDPOINT?.trim() || '';
const workerOrigin = 'https://sahmt-label-ai.anestesiahmtforms.workers.dev';
const workerPath = '/v1/labels/extract';
const unavailableMessage = 'Não foi possível realizar a leitura por IA. Tente novamente ou preencha os campos manualmente.';

function configuredWorkerEndpoint() {
  let endpoint;
  try { endpoint = new URL(workerEndpoint); }
  catch { throw new Error('A leitura por IA está aguardando a configuração pública do Worker. Use o registro manual.'); }
  if (endpoint.protocol !== 'https:' || endpoint.origin !== workerOrigin || endpoint.pathname !== workerPath || endpoint.search || endpoint.hash) {
    throw new Error('O endereço do leitor de etiquetas não é válido. Use o registro manual.');
  }
  return endpoint.href;
}

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
  if (!app || !auth) throw new Error('O Firebase não está configurado neste app.');
  if (!(file instanceof Blob) || !/^image\/(?:jpeg|png|webp)$/i.test(file.type) || file.size > 12 * 1024 * 1024) {
    throw new Error('Escolha uma imagem JPG, PNG ou WebP de até 12 MB.');
  }
  const endpoint = configuredWorkerEndpoint();
  const user = auth.currentUser;
  if (!user) throw new Error('Entre novamente no SAHMT para ler a etiqueta.');
  const appCheck = await appCheckReady;
  if (!appCheck) throw new Error('A leitura por IA aguarda a configuração do App Check para este domínio. Você pode continuar pelo registro manual.');
  let idToken;
  let appCheckToken;
  try {
    const [{getToken}, refreshedIdToken] = await Promise.all([
      import('firebase/app-check').then((module) => module),
      user.getIdToken()
    ]);
    idToken = refreshedIdToken;
    appCheckToken = (await getToken(appCheck)).token;
  } catch {
    throw new Error('Não foi possível validar a sessão e a proteção do app. Atualize a página ou faça o registro manual.');
  }
  if (!idToken || !appCheckToken) throw new Error('Não foi possível validar a sessão e a proteção do app. Atualize a página ou faça o registro manual.');

  const image = await loadImage(file);
  const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  let imageData;
  const numericImageDataUrls = [];
  try {
    const context = canvas.getContext('2d', {willReadFrequently: false});
    if (!context) throw new Error('Não foi possível preparar a foto.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    imageData = await imageDataUrl(canvas, 440 * 1024);
    if (!imageData) throw new Error('A foto não pôde ser compactada. Capture novamente com mais luz.');
    const cropTop = Math.floor(canvas.height * .58);
    const cropHeight = canvas.height - cropTop;
    const cropWidth = Math.floor(canvas.width / 2);
    for (const left of [0, cropWidth]) {
      const crop = document.createElement('canvas');
      crop.width = Math.max(1, left ? canvas.width - cropWidth : cropWidth);
      crop.height = Math.max(1, cropHeight);
      try {
        crop.getContext('2d')?.drawImage(canvas, left, cropTop, crop.width, crop.height, 0, 0, crop.width, crop.height);
        const data = await imageDataUrl(crop, 55 * 1024);
        if (data) numericImageDataUrls.push(data);
      } finally {
        crop.width = 0;
        crop.height = 0;
      }
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'X-Firebase-AppCheck': appCheckToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({imageDataUrl: imageData, numericImageDataUrls}),
      signal: AbortSignal.timeout(65_000)
    });
  } catch {
    throw new Error(unavailableMessage);
  }
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error(unavailableMessage); }
  if (!response.ok) {
    const code = payload?.error?.code;
    if (code === 'PERMISSION_DENIED') throw new Error('Seu perfil não tem permissão para ler etiquetas. O registro manual continua disponível.');
    if (code === 'UNAUTHENTICATED' || code === 'INVALID_APP_CHECK' || code === 'APP_CHECK_REQUIRED') {
      throw new Error('A sessão ou a proteção do app precisa ser atualizada. Entre novamente ou faça o registro manual.');
    }
    if (code === 'INVALID_IMAGE' || code === 'IMAGE_TOO_LARGE') throw new Error(payload?.error?.message || 'A imagem está inválida. Capture novamente ou preencha os campos manualmente.');
    throw new Error(unavailableMessage);
  }
  return payload;
}
