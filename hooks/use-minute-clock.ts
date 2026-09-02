import { useEffect, useState } from 'react';

// Only the compact live block rerenders each minute. No backend polling.
export function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function update() {
      clearTimeout(timer);
      const instant = Date.now();
      setNow(instant);
      if (!document.hidden)
        timer = setTimeout(update, 60_000 - (instant % 60_000));
    }
    update();
    window.addEventListener('focus', update);
    window.addEventListener('pageshow', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('pageshow', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return now;
}
