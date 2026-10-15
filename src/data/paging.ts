import { getDocs, limit, query, startAfter, type DocumentData, type Query, type QueryDocumentSnapshot } from 'firebase/firestore';

/** Iterate bounded pages for explicit cleanup; regular UI reads use a single page. */
export async function forEachPage(source: Query<DocumentData>, action: (rows: QueryDocumentSnapshot<DocumentData>[]) => Promise<void>, size = 50): Promise<void> {
  let cursor: QueryDocumentSnapshot<DocumentData> | undefined;
  while (true) {
    const page = await getDocs(query(source, ...(cursor ? [startAfter(cursor)] : []), limit(size)));
    if (!page.size) return;
    await action(page.docs);
    cursor = page.docs[page.docs.length - 1];
    if (page.size < size) return;
  }
}
