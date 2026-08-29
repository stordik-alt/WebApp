export type OcrPreprocessOptions = {
  scale?: number;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
};

/**
 * Prepare a screenshot for vision OCR without modifying the original upload.
 * Runs in the browser so the AI receives a larger, normalized image while
 * storage can continue to keep the original screenshot unchanged.
 */
export async function preprocessOcrImage(
  dataUrl: string,
  options: OcrPreprocessOptions = {},
): Promise<string> {
  const scale = options.scale ?? 2;
  const quality = options.quality ?? 0.94;
  const maxWidth = options.maxWidth ?? 4096;
  const maxHeight = options.maxHeight ?? 4096;

  if (!dataUrl.startsWith("data:image/")) return dataUrl;

  const image = new Image();
  image.decoding = "async";
  image.src = dataUrl;
  await image.decode();

  const targetScale = Math.max(1, scale);
  const width = Math.min(Math.round(image.naturalWidth * targetScale), maxWidth);
  const height = Math.min(Math.round(image.naturalHeight * targetScale), maxHeight);
  if (width === image.naturalWidth && height === image.naturalHeight) return dataUrl;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return dataUrl;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", quality);
}
