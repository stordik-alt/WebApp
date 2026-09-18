/**
 * Races `promise` against a timer. Without this, a stalled OCR server-function
 * call never resolves or rejects, so callers awaiting it (and any try/catch
 * meant to mark the item as ERROR on failure) never run either - the item's
 * DB row is left parked in an intermediate status (e.g. VALIDATING) forever,
 * with no error recorded, and the import UI shows it as perpetually "stuck".
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
