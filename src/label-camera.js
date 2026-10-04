export function bindLabelCamera(form) {
  const openButton = form.querySelector('#label-camera-open');
  const closeButton = form.querySelector('#label-camera-close');
  const captureButton = form.querySelector('#label-camera-capture');
  const dialog = form.querySelector('#label-camera-dialog');
  const video = form.querySelector('#label-camera-video');
  const target = form.querySelector('.label-camera-target');
  let photoPreview = null;
  const status = form.querySelector('#label-camera-status');
  const fileInput = form.querySelector('#label-image-file');
  if (!openButton || !dialog || !video || !captureButton || !fileInput) return () => {};
  try {
    photoPreview = document.createElement('img');
    photoPreview.alt = 'Prévia da foto da etiqueta';
    photoPreview.hidden = true;
    photoPreview.className = 'label-camera-photo';
    target?.parentElement?.insertBefore(photoPreview, target);
  } catch {
    photoPreview = null;
  }
  const controller = new AbortController();
  const {signal} = controller;
  let stream = null;
  let previewUrl = '';
  let generatedCapture = null;
  let requestGeneration = 0;
  const clearPhotoPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    photoPreview?.removeAttribute('src');
    if (photoPreview) photoPreview.hidden = true;
    video.hidden = false;
  };
  const stopStream = () => {
    requestGeneration++;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    captureButton.disabled = true;
  };
  const startCamera = async () => {
    const generation = ++requestGeneration;
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'Este navegador não oferece câmera direta. Abrindo a câmera do aparelho para capturar a etiqueta.';
      fileInput.click();
      return;
    }
    captureButton.disabled = true;
    status.textContent = 'Solicitando acesso à câmera…';
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({audio: false, video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1080}}});
      if (generation !== requestGeneration || !dialog.open) {
        nextStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = nextStream;
      video.srcObject = stream;
      await video.play();
      if (generation !== requestGeneration || !dialog.open) return;
      captureButton.disabled = false;
      status.textContent = 'Enquadre a etiqueta na moldura central. Apenas essa área será capturada.';
    } catch (error) {
      if (generation !== requestGeneration) return;
      stopStream();
      const detail = error.name === 'NotAllowedError' ? 'Permita o acesso à câmera nas configurações do navegador.'
        : error.name === 'NotFoundError' ? 'Nenhuma câmera compatível foi encontrada.'
          : 'Não foi possível iniciar a câmera neste aparelho.';
      status.textContent = `${detail} Escolha a foto da etiqueta para continuar.`;
      fileInput.click();
    }
  };
  const onOpen = () => {
    fileInput.value = '';
    generatedCapture = null;
    clearPhotoPreview();
    video.hidden = false;
    if (!dialog.open) dialog.showModal();
    void startCamera();
  };
  const onClose = () => dialog.close();
  const onFileChange = () => {
    const file = fileInput.files?.[0];
    if (!file || file === generatedCapture) {
      if (file === generatedCapture) generatedCapture = null;
      return;
    }
    if (!photoPreview) {
      status.textContent = 'Não foi possível mostrar a prévia para enquadrar a foto. Use a câmera direta ou o registro manual.';
      return;
    }
    stopStream();
    clearPhotoPreview();
    video.hidden = true;
    photoPreview.hidden = false;
    previewUrl = URL.createObjectURL(file);
    photoPreview.onload = () => {
      if (!dialog.open) return;
      captureButton.disabled = false;
      status.textContent = 'Confira o enquadramento da foto na moldura central e toque em CAPTURAR E LER ETIQUETA.';
    };
    photoPreview.onerror = () => {
      captureButton.disabled = true;
      status.textContent = 'Não foi possível abrir esta foto. Escolha outra imagem ou use o registro manual.';
    };
    status.textContent = 'Preparando a prévia para ajustar o enquadramento…';
    photoPreview.src = previewUrl;
  };
  const onCapture = () => {
    const source = photoPreview && !photoPreview.hidden ? photoPreview : video;
    const sourceWidth = source === video ? video.videoWidth : photoPreview.naturalWidth;
    const sourceHeight = source === video ? video.videoHeight : photoPreview.naturalHeight;
    if (!sourceWidth || !sourceHeight) {
      status.textContent = 'A câmera ainda está ajustando a imagem. Tente novamente em alguns segundos.';
      return;
    }
    if (typeof DataTransfer !== 'function') {
      status.textContent = 'Este navegador não permite transferir a captura ao leitor. Use o campo Foto ou arquivo.';
      return;
    }
    let sourceLeft = 0;
    let sourceTop = 0;
    let cropWidth = sourceWidth;
    let cropHeight = sourceHeight;
    if (target) {
      const videoRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      if (!videoRect.width || !videoRect.height || !targetRect.width || !targetRect.height) {
        status.textContent = 'A moldura da câmera ainda não está pronta. Tente novamente.';
        return;
      }
      // The preview uses object-fit: cover, so map the visible target back to source pixels.
      const coverScale = Math.max(videoRect.width / sourceWidth, videoRect.height / sourceHeight);
      const imageLeft = (videoRect.width - sourceWidth * coverScale) / 2;
      const imageTop = (videoRect.height - sourceHeight * coverScale) / 2;
      sourceLeft = Math.max(0, (targetRect.left - videoRect.left - imageLeft) / coverScale);
      sourceTop = Math.max(0, (targetRect.top - videoRect.top - imageTop) / coverScale);
      cropWidth = Math.min(sourceWidth, (targetRect.right - videoRect.left - imageLeft) / coverScale) - sourceLeft;
      cropHeight = Math.min(sourceHeight, (targetRect.bottom - videoRect.top - imageTop) / coverScale) - sourceTop;
    }
    if (cropWidth < 1 || cropHeight < 1) {
      status.textContent = 'Não foi possível localizar a moldura na imagem. Ajuste a câmera e tente novamente.';
      return;
    }
    const scale = Math.min(1, 2200 / Math.max(cropWidth, cropHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(cropWidth * scale));
    canvas.height = Math.max(1, Math.round(cropHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      status.textContent = 'Não foi possível preparar a captura. Tente novamente ou escolha uma foto.';
      return;
    }
    context.drawImage(source, sourceLeft, sourceTop, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    captureButton.disabled = true;
    const generation = requestGeneration;
    canvas.toBlob((blob) => {
      canvas.width = 0;
      canvas.height = 0;
      if (generation !== requestGeneration || !dialog.open || !fileInput.isConnected) return;
      if (!blob) {
        status.textContent = 'Não foi possível preparar a captura. Tente novamente ou escolha uma foto.';
        captureButton.disabled = false;
        return;
      }
      const file = new File([blob], `sahmt-etiqueta-${Date.now()}.jpg`, {type: 'image/jpeg', lastModified: Date.now()});
      const transfer = new DataTransfer();
      transfer.items.add(file);
      stopStream();
      clearPhotoPreview();
      dialog.close();
      fileInput.files = transfer.files;
      generatedCapture = file;
      fileInput.dispatchEvent(new Event('change', {bubbles: true}));
      fileInput.dispatchEvent(new Event('label-captured', {bubbles: true}));
    }, 'image/jpeg', 0.92);
  };
  const onDialogClose = () => {
    const unconfirmedPhoto = Boolean(photoPreview && !photoPreview.hidden);
    stopStream();
    clearPhotoPreview();
    if (unconfirmedPhoto) fileInput.value = '';
  };
  const onBackdrop = (event) => { if (event.target === dialog) dialog.close(); };
  openButton.addEventListener('click', onOpen, {signal});
  closeButton?.addEventListener('click', onClose, {signal});
  captureButton.addEventListener('click', onCapture, {signal});
  fileInput.addEventListener('change', onFileChange, {signal});
  dialog.addEventListener('close', onDialogClose, {signal});
  dialog.addEventListener('click', onBackdrop, {signal});
  return () => {
    controller.abort();
    stopStream();
    clearPhotoPreview();
    if (dialog.open) dialog.close();
  };
}
