import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { workerPost } from '../services/workerApi';
export type SubscriptionStatus = { pro: boolean; freeChatsRemaining: number; expiresAt: number; billingReady: boolean };
const Context = createContext<{ status: SubscriptionStatus | null; error: string | null; refresh: (force?: boolean) => Promise<SubscriptionStatus | null> } | null>(null);
export function SubscriptionProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const uid = user?.deletionPending ? undefined : user?.id;
  const currentUid = useRef(uid); currentUid.current = uid;
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState<{ uid: string; status: SubscriptionStatus } | null>(null);
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async (force = false) => {
    const request = ++generation.current;
    if (!uid) return null;
    try {
      const status = await workerPost<SubscriptionStatus>(uid, '/subscription-status', { force });
      if (currentUid.current !== uid || request !== generation.current) return null;
      setSnapshot({ uid, status }); setError(null); return status;
    } catch (err) {
      if (currentUid.current === uid && request === generation.current) {
        // A transient failure must not demote a verified Pro user: keep the last known status and only
        // surface an error when nothing is known yet.
        if (snapshotRef.current?.uid === uid) setError(null);
        else { setSnapshot(null); setError(err instanceof Error ? err.message : 'Abonelik kontrol edilemedi.'); }
      }
      return null;
    }
  }, [uid]);
  useEffect(() => { setSnapshot(null); setError(null); void refresh(); const listener = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); }); return () => { generation.current++; listener.remove(); }; }, [refresh]);
  const status = snapshot && snapshot.uid === uid ? snapshot.status : null;
  const value = useMemo(() => ({ status, error, refresh }), [status, error, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useSubscription() { const value = useContext(Context); if (!value) throw new Error('SubscriptionProvider gerekli.'); return value; }
