/**
 * First-run onboarding state, persisted via appStorage so the intro shows
 * once and can be replayed on demand from Settings.
 */
import { useEffect, useState, useCallback } from 'react';
import { appStorage } from '../session/async-storage-adapter';

const ONBOARDING_KEY = 'onboarding_seen_v1';

export function useOnboarding() {
  // null = still loading; true/false once resolved.
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    appStorage.getItem(ONBOARDING_KEY).then(v => {
      if (!cancelled) setSeen(v === 'true');
    });
    return () => { cancelled = true; };
  }, []);

  const markSeen = useCallback(() => {
    setSeen(true);
    void appStorage.setItem(ONBOARDING_KEY, 'true');
  }, []);

  const replay = useCallback(() => {
    setSeen(false);
  }, []);

  return { seen, markSeen, replay };
}
