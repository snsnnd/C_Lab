import { useEffect, useRef, type ReactNode } from 'react';

// React Bits FadeContent, adapted to the Web Animations API for a local,
// reduced-motion-friendly lesson transition. No scroll animation dependency.
// Reference: https://reactbits.dev/animations/fade-content (MIT).
export function FadeContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = ref.current?.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    return () => animation?.cancel();
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}
