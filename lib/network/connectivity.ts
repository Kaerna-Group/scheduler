export function readOnlineStatus() {
  try {
    return navigator.onLine;
  } catch {
    return true;
  }
}

export function subscribeToNetworkStatus(listener: (online: boolean) => void) {
  const handleOnline = () => listener(true);
  const handleOffline = () => listener(false);
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
