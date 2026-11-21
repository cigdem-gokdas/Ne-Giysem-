import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { syncPurchasesUser } from './purchases';
import { reportError } from '../services/telemetry';
import { workerPost } from '../services/workerApi';
export type SubscriptionStatus = { pro: boolean; freeChatsRemaining: number; expiresAt: number; billingReady: boolean };
export type SubscriptionErrorKind = 'auth' | 'unavailable';
const Context = createContext<{ status: SubscriptionStatus | null; error: string | null; errorKind: SubscriptionErrorKind | null; loading: boolean; refresh: (force?: boolean) => Promise<SubscriptionStatus | null> } | null>(null);
export function SubscriptionProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const uid = user?.deletionPending ? undefined : user?.id;
  const currentUid = useRef(uid); currentUid.current = uid;
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState<{ uid: string; status: SubscriptionStatus } | null>(null);
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<SubscriptionErrorKind | null>(null);
  const [pending, setPending] = useState(0);
  const refresh = useCallback(async (force = false) => {
    const request = ++generation.current;
    if (!uid) return null;
    setPending(n => n + 1);
    try {
      const status = await workerPost<SubscriptionStatus>(uid, '/subscription-status', { force });
      if (currentUid.current !== uid || request !== generation.current) return null;
      setSnapshot({ uid, status }); setError(null); setErrorKind(null); return status;
    } catch (err) {
      reportError('subscription_status', err);
      if (currentUid.current === uid && request === generation.current) {
        // A transient failure must not demote a verified Pro user: keep the last known status and only
        // surface an error when nothing is known yet.
        const message = err instanceof Error ? err.message : 'Abonelik kontrol edilemedi.';
        setError(message); setErrorKind(/Oturum|401/.test(message) ? 'auth' : 'unavailable');
        if (snapshotRef.current?.uid !== uid) setSnapshot(null);
      }
      return null;
    } finally { setPending(n => Math.max(0, n - 1)); }
  }, [uid]);
  useEffect(() => { setSnapshot(null); setError(null); setErrorKind(null); void syncPurchasesUser(uid ?? null); void refresh(); const listener = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); }); return () => { generation.current++; listener.remove(); }; }, [refresh, uid]);
  const status = snapshot && snapshot.uid === uid ? snapshot.status : null;
  const value = useMemo(() => ({ status, error, errorKind, loading: pending > 0, refresh }), [status, error, errorKind, pending, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useSubscription() { const value = useContext(Context); if (!value) throw new Error('SubscriptionProvider gerekli.'); return value; }
