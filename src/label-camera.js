export function bindLabelCamera(form) {
  const openButton = form.querySelector('#label-camera-open');
  const closeButton = form.querySelector('#label-camera-close');
  const captureButton = form.querySelector('#label-camera-capture');
  const dialog = form.querySelector('#label-camera-dialog');
  const video = form.querySelector('#label-camera-video');
  const target = form.querySelector('.label-camera-target');
  const status = form.querySelector('#label-camera-status');
  const fileInput = form.querySelector('#label-ocr-file');
  if (!openButton || !dialog || !video || !captureButton || !fileInput) return () => {};
  const controller = new AbortController();
  const {signal} = controller;
  let stream = null;
  let requestGeneration = 0;
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
    if (!dialog.open) dialog.showModal();
    void startCamera();
  };
  const onClose = () => dialog.close();
  const onCapture = () => {
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
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
      const videoRect = video.getBoundingClientRect();
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
    context.drawImage(video, sourceLeft, sourceTop, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    captureButton.disabled = true;
    canvas.toBlob((blob) => {
      canvas.width = 0;
      canvas.height = 0;
      if (!fileInput.isConnected) return;
      if (!blob) {
        status.textContent = 'Não foi possível preparar a captura. Tente novamente ou escolha uma foto.';
        captureButton.disabled = false;
        return;
      }
      const file = new File([blob], `sahmt-etiqueta-${Date.now()}.jpg`, {type: 'image/jpeg', lastModified: Date.now()});
      const transfer = new DataTransfer();
      transfer.items.add(file);
      stopStream();
      dialog.close();
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event('change', {bubbles: true}));
    }, 'image/jpeg', 0.92);
  };
  const onDialogClose = () => stopStream();
  const onBackdrop = (event) => { if (event.target === dialog) dialog.close(); };
  openButton.addEventListener('click', onOpen, {signal});
  closeButton?.addEventListener('click', onClose, {signal});
  captureButton.addEventListener('click', onCapture, {signal});
  dialog.addEventListener('close', onDialogClose, {signal});
  dialog.addEventListener('click', onBackdrop, {signal});
  return () => {
    controller.abort();
    stopStream();
    if (dialog.open) dialog.close();
  };
}
