export type OcrPreprocessOptions = {
  scale?: number;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
};

/**
 * Creates a temporary, enlarged JPEG for OCR. The original upload is never
 * modified; callers can continue uploading the original File to storage.
 * If browser image processing is unavailable or fails, the original data URL
 * is returned so OCR can continue unchanged.
 */
export async function preprocessOcrImage(
  dataUrl: string,
  options: OcrPreprocessOptions = {},
): Promise<string> {
  try {
    const scale = Math.max(1, options.scale ?? 2);
    const quality = options.quality ?? 0.94;
    const maxWidth = options.maxWidth ?? 4096;
    const maxHeight = options.maxHeight ?? 4096;

    if (!dataUrl.startsWith("data:image/")) return dataUrl;

    const image = new Image();
    image.decoding = "async";
    image.src = dataUrl;
    await image.decode();

    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    if (!sourceWidth || !sourceHeight) return dataUrl;

    const limitingScale = Math.min(
      scale,
      maxWidth / sourceWidth,
      maxHeight / sourceHeight,
    );
    const targetScale = Math.max(1, limitingScale);
    const width = Math.max(1, Math.round(sourceWidth * targetScale));
    const height = Math.max(1, Math.round(sourceHeight * targetScale));

    if (width === sourceWidth && height === sourceHeight) return dataUrl;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return dataUrl;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, width, height);

    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return dataUrl;
  }
}
