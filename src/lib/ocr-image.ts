export type OcrPreprocessOptions = {
  scale?: number;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
};

/**
 * Creates a temporary JPEG optimized for OCR. The original upload is never
 * modified; callers can continue uploading the original File to storage.
 * The output is both enlarged when useful and reduced when the source would
 * make the AI request unnecessarily large.
 */
export async function preprocessOcrImage(
  dataUrl: string,
  options: OcrPreprocessOptions = {},
): Promise<string> {
  try {
    const scale = Math.max(0.25, options.scale ?? 2);
    const quality = Math.min(1, Math.max(0.5, options.quality ?? 0.9));
    const maxWidth = Math.max(512, options.maxWidth ?? 4096);
    const maxHeight = Math.max(512, options.maxHeight ?? 4096);

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
    const targetScale = Math.max(0.25, limitingScale);
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
