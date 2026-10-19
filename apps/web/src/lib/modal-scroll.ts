import { useEffect } from 'react';

let lockCount = 0;
let releaseBody: (() => void) | null = null;

/** Lock the page (including iOS Safari) while allowing an inner modal to scroll. */
export function useModalScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    if (lockCount++ === 0) {
      const scrollY = window.scrollY;
      const body = document.body;
      const html = document.documentElement;
      const previous = {
        position: body.style.position, top: body.style.top, width: body.style.width,
        overflow: body.style.overflow, paddingRight: body.style.paddingRight,
        htmlOverflow: html.style.overflow,
      };
      const gutter = Math.max(0, window.innerWidth - html.clientWidth);
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.width = '100%';
      body.style.overflow = 'hidden';
      if (gutter) body.style.paddingRight = `${gutter}px`;
      html.style.overflow = 'hidden';
      releaseBody = () => {
        body.style.position = previous.position;
        body.style.top = previous.top;
        body.style.width = previous.width;
        body.style.overflow = previous.overflow;
        body.style.paddingRight = previous.paddingRight;
        html.style.overflow = previous.htmlOverflow;
        window.scrollTo(0, scrollY);
      };
    }
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        releaseBody?.();
        releaseBody = null;
      }
    };
  }, [active]);
}
