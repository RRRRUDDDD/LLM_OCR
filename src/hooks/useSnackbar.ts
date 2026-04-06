import { useState, useRef, useCallback, useEffect } from 'react';
import type { SnackbarType } from '../types/ui';

export default function useSnackbar(duration = 2500) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [type, setType] = useState<SnackbarType>('success');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const show = useCallback((msg: string, msgType: SnackbarType = 'success') => {
    setMessage(msg);
    setType(msgType);
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), duration);
  }, [duration]);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  return { visible, message, type, show, dismiss };
}
