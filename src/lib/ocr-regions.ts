export type OcrRegion = "header" | "employees" | "hourly";

type RegionBounds = { top: number; bottom: number };

// The production screenshots use a vertically stacked layout: header at the top,
// employee table in the middle, and hourly production table at the bottom.
// Bounds are intentionally centralized so the layout can be tuned without touching
// OCR or import logic.
const REGION_BOUNDS: Record<OcrRegion, RegionBounds> = {
  header: { top: 0, bottom: 0.25 },
  employees: { top: 0.2, bottom: 0.62 },
  hourly: { top: 0.57, bottom: 1 },
};

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("OCR obrázek se nepodařilo načíst."));
    image.src = dataUrl;
  });
}

/**
 * Creates a temporary in-memory crop for one OCR pass.
 * The source data URL is never modified.
 */
export async function cropOcrRegion(dataUrl: string, region: OcrRegion): Promise<string> {
  const image = await loadImage(dataUrl);
  const bounds = REGION_BOUNDS[region];
  const top = Math.max(0, Math.floor(image.naturalHeight * bounds.top));
  const bottom = Math.min(image.naturalHeight, Math.ceil(image.naturalHeight * bounds.bottom));
  const height = Math.max(1, bottom - top);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("OCR canvas není dostupný.");
  context.drawImage(image, 0, top, image.naturalWidth, height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.94);
}

export async function cropOcrRegions(dataUrl: string): Promise<Record<OcrRegion, string>> {
  const [header, employees, hourly] = await Promise.all([
    cropOcrRegion(dataUrl, "header"),
    cropOcrRegion(dataUrl, "employees"),
    cropOcrRegion(dataUrl, "hourly"),
  ]);
  return { header, employees, hourly };
}
