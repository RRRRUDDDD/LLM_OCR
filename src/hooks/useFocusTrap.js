import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Trap keyboard focus inside a dialog while it is open.
 * Returns a ref to attach to the dialog container element.
 */
export default function useFocusTrap(isOpen) {
  const ref = useRef(null);

  useEffect(() => {
    if (!isOpen || !ref.current) return;

    const dialog = ref.current;
    const focusable = () => dialog.querySelectorAll(FOCUSABLE);

    // Focus first focusable element on open
    const elements = focusable();
    if (elements.length > 0) elements[0].focus();

    const handleKeyDown = (e) => {
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
