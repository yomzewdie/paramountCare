import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

/**
 * Foundation-level offline detection only (M3 §18): shows an "offline" UX
 * signal. It deliberately does NOT queue writes for later replay — silently
 * queuing a sensitive submission (a signed form, an uploaded document) while
 * offline and sending it later without the applicant re-confirming is a
 * product/legal decision, not an engineering default, and is explicitly out
 * of scope here. See README.md "Offline strategy" for the future plan.
 */
export function useNetworkStatus(): { isConnected: boolean } {
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      // `state.isConnected` can briefly be `null` while NetInfo is still
      // determining status — treated as "assume connected" so the offline
      // banner doesn't flash on every screen mount.
      setIsConnected(state.isConnected !== false);
    });
    return unsubscribe;
  }, []);

  return { isConnected };
}
