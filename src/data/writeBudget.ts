import { doc, runTransaction, serverTimestamp, Timestamp, type DocumentData, type DocumentReference } from 'firebase/firestore';
import { firebaseAuth, firestore } from '../config/firebase';

export type BudgetWrite = { ref: DocumentReference<DocumentData>; data: DocumentData; update?: boolean };
export async function budgetWrites(writes: BudgetWrite[]): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user || !user.emailVerified) throw new Error('Önce e-posta adresini doğrulamalısın.');
  if (!writes.length || writes.length > 2 || new Set(writes.map((w) => w.ref.path)).size !== writes.length) throw new Error('Geçersiz kayıt işlemi.');
  const budget = doc(firestore, 'write_limits', user.uid);
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(budget);
    const now = new Date();
    const day = Timestamp.fromMillis(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const previous = snapshot.data();
    const count = previous?.day?.isEqual(day) ? Number(previous.count) : 0;
    if (count + writes.length > 150) throw new Error('Günlük 150 kayıt/değişiklik sınırına ulaştın. Yarın tekrar deneyebilirsin.');
    transaction.set(budget, { day, count: count + writes.length, paths: writes.map((write) => write.ref.path), at: serverTimestamp() });
    for (const write of writes) {
      if (write.update) transaction.update(write.ref, write.data);
      else transaction.set(write.ref, write.data);
    }
  });
}
export const limitedSet = (ref: DocumentReference<DocumentData>, data: DocumentData) => budgetWrites([{ ref, data }]);
export const limitedUpdate = (ref: DocumentReference<DocumentData>, data: DocumentData) => budgetWrites([{ ref, data, update: true }]);
