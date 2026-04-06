import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function useFocusTrap<T extends HTMLElement>(isOpen: boolean): RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!isOpen || !ref.current) return;

    const dialog = ref.current;
    const focusable = (): NodeListOf<HTMLElement> => dialog.querySelectorAll<HTMLElement>(FOCUSABLE);

    // 打开时聚焦第一个可聚焦元素
    const elements = focusable();
    if (elements.length > 0) elements[0].focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const nodes = focusable();
      if (nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return ref;
}
