import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getPageLabel } from '@/utils';

const BackNavContext = createContext({ previous: null });

export function BackNavProvider({ children }) {
  const location = useLocation();
  const prevRef = useRef(null);
  const [previous, setPrevious] = useState(() => {
    try {
      const stored = sessionStorage.getItem('pp_prev_route');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const path = `${location.pathname}${location.search || ''}`;
    const current = { path, label: getPageLabel(location.pathname) };

    if (!prevRef.current) {
      prevRef.current = current;
      return;
    }

    if (prevRef.current.path !== current.path) {
      setPrevious(prevRef.current);
      try {
        sessionStorage.setItem('pp_prev_route', JSON.stringify(prevRef.current));
      } catch {
        // ignore
      }
      prevRef.current = current;
    }
  }, [location.pathname, location.search]);

  const value = useMemo(() => ({ previous }), [previous]);

  return <BackNavContext.Provider value={value}>{children}</BackNavContext.Provider>;
}

export function useBackNav() {
  return useContext(BackNavContext);
}
