import * as React from 'react';

export function usePendingGuard(label, options) {
  const timeoutMs = Number.isFinite(options?.timeoutMs) ? Number(options.timeoutMs) : 20_000;

  const [timedOut, setTimedOut] = React.useState(false);
  const timerRef = React.useRef(null);
  const pendingRef = React.useRef(false);
  const retryRef = React.useRef(null);
  const onTimeoutRef = React.useRef(null);
  const labelRef = React.useRef(label);

  labelRef.current = label;

  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const stop = React.useCallback(() => {
    pendingRef.current = false;
    retryRef.current = null;
    onTimeoutRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setTimedOut(false);
  }, []);

  const start = React.useCallback(
    ({ retry, onTimeout } = {}) => {
      pendingRef.current = true;
      retryRef.current = typeof retry === 'function' ? retry : null;
      onTimeoutRef.current = typeof onTimeout === 'function' ? onTimeout : null;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      setTimedOut(false);

      timerRef.current = setTimeout(() => {
        if (!pendingRef.current) return;
        setTimedOut(true);
        try {
          onTimeoutRef.current?.({
            label: labelRef.current,
            timeoutMs,
            retry: retryRef.current,
          });
        } catch {
          // ignore
        }
      }, timeoutMs);
    },
    [timeoutMs]
  );

  const watch = React.useCallback(
    (isPending, { retry, onTimeout } = {}) => {
      const nextPending = !!isPending;
      if (nextPending === pendingRef.current) return;
      if (nextPending) start({ retry, onTimeout });
      else stop();
    },
    [start, stop]
  );

  const retry = React.useCallback(() => {
    try {
      return retryRef.current?.();
    } catch {
      return undefined;
    }
  }, []);

  return {
    timedOut,
    start,
    stop,
    watch,
    retry,
    timeoutMs,
  };
}
