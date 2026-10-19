import type { UIEvent } from 'react';
import { useModalScrollLock } from '../../lib/modal-scroll';

const scrollingTimers = new WeakMap<HTMLElement, number>();

/** Thin modal scrollbar remains invisible until scrolling, then fades away. */
export function showScrollbarWhileScrolling(event: UIEvent<HTMLElement>) {
  const element = event.currentTarget;
  element.classList.add('is-scrolling');
  const previous = scrollingTimers.get(element);
  if (previous !== undefined) window.clearTimeout(previous);
  const timer = window.setTimeout(() => {
    element.classList.remove('is-scrolling');
    scrollingTimers.delete(element);
  }, 850);
  scrollingTimers.set(element, timer);
}

export function ModalScrollLock() {
  useModalScrollLock();
  return null;
}
