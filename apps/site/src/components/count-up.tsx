'use client';

import { useEffect, useState } from 'react';

/** Counts from zero to `to` once on mount; shows the final value straight away for reduced motion. */
export function CountUp({
  to,
  ms = 1200,
  delay = 0,
  format = (n: number) => String(Math.round(n)),
}: {
  to: number;
  ms?: number;
  delay?: number;
  format?: (n: number) => string;
}) {
  const [value, setValue] = useState(to);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let start = 0;
    setValue(0);
    const timer = setTimeout(() => {
      const tick = (now: number) => {
        start ||= now;
        const t = Math.min(1, (now - start) / ms);
        setValue(to * (1 - Math.pow(1 - t, 3)));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [to, ms, delay]);
  return <>{format(value)}</>;
}
