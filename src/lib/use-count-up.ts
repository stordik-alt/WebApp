import { useEffect, useRef, useState } from "react";

/** Animates a numeric KPI value from its previous value (or 0 on first mount) to `target` with an ease-out curve. Returns `target` unchanged (null passthrough) when it isn't a finite number. */
export function useCountUp(target: number | null, durationMs = 700): number | null {
  const [value, setValue] = useState<number | null>(target);
  const fromRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target == null || !Number.isFinite(target)) {
      setValue(target);
      return;
    }
    const from = fromRef.current;
    let start: number | null = null;
    const tick = (t: number) => {
      if (start == null) start = t;
      const progress = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(from + (target - from) * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return value;
}
