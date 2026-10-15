import { getDocs, type DocumentData, type Query, type QuerySnapshot } from 'firebase/firestore';

/** Keep production ordering, but remain usable while a newly deployed composite index is building. */
export async function getDocsWithIndexFallback(
  ordered: Query<DocumentData, DocumentData>,
  fallback: Query<DocumentData, DocumentData>,
): Promise<QuerySnapshot<DocumentData, DocumentData>> {
  try {
    return await getDocs(ordered);
  } catch (error) {
    if ((error as { code?: string })?.code !== 'failed-precondition') throw error;
    return getDocs(fallback);
  }
}
