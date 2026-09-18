/**
 * fetch() with a hard timeout via AbortController. Plain fetch() has no
 * default timeout - a stalled upstream server (no response, connection kept
 * open with no data) leaves the promise pending forever. For a multi-provider
 * fallback chain (OCR calls try OpenRouter, then Lovable AI on failure) that
 * also silently defeats the fallback: the loop never even reaches the second
 * provider because the first attempt never rejects.
 */
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
