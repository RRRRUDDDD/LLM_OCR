import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * @typedef {'success'|'error'|'info'} SnackbarType
 */

export default function useSnackbar(duration = 2500) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [type, setType] = useState('success');
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const show = useCallback((msg, msgType = 'success') => {
    setMessage(msg);
    setType(msgType);
    setVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), duration);
  }, [duration]);

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  return { visible, message, type, show, dismiss };
}
