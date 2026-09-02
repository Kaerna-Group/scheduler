import { useSyncExternalStore } from 'react';

const LOCATION_EVENT = 'scheduler-location-changed';
function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  window.addEventListener('popstate', listener);
  window.addEventListener(LOCATION_EVENT, listener);
  return () => {
    window.removeEventListener('hashchange', listener);
    window.removeEventListener('popstate', listener);
    window.removeEventListener(LOCATION_EVENT, listener);
  };
}
export function useAppLocation() {
  return useSyncExternalStore(subscribe, () => window.location.href);
}
export function navigateSchedule(url: string, replace = false) {
  if (url === window.location.href) return;
  if (replace) window.history.replaceState(window.history.state, '', url);
  else window.history.pushState(null, '', url);
  // push/replaceState do not emit hashchange or popstate.
  window.dispatchEvent(new Event(LOCATION_EVENT));
}
