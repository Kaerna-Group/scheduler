import { useEffect, useState } from 'react';

import {
  readOnlineStatus,
  subscribeToNetworkStatus,
} from '@/lib/network/connectivity';

export function useNetworkStatus() {
  const [online, setOnline] = useState(readOnlineStatus);

  useEffect(() => subscribeToNetworkStatus(setOnline), []);

  return online;
}
