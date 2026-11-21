import { getDocs, type DocumentData, type Query, type QuerySnapshot } from 'firebase/firestore';
import { reportError } from '../services/telemetry';

export type IndexedQueryResult = { snapshot: QuerySnapshot<DocumentData, DocumentData>; degraded: boolean };

/** Keep production ordering, but remain usable while a newly deployed composite index is building.
 * The fallback is logged and reported (`degraded: true`) so callers can surface that ordering/paging is unreliable. */
export async function getDocsWithIndexFallbackInfo(
  ordered: Query<DocumentData, DocumentData>,
  fallback: Query<DocumentData, DocumentData>,
): Promise<IndexedQueryResult> {
  try {
    return { snapshot: await getDocs(ordered), degraded: false };
  } catch (error) {
    if ((error as { code?: string })?.code !== 'failed-precondition') throw error;
    console.warn('[firestore] Sıralı dizin hazır değil; sıralamasız sorguya geçildi.');
    reportError('firestore_index_fallback', error);
    return { snapshot: await getDocs(fallback), degraded: true };
  }
}

export async function getDocsWithIndexFallback(
  ordered: Query<DocumentData, DocumentData>,
  fallback: Query<DocumentData, DocumentData>,
): Promise<QuerySnapshot<DocumentData, DocumentData>> {
  return (await getDocsWithIndexFallbackInfo(ordered, fallback)).snapshot;
}
