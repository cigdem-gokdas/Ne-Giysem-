import { doc, runTransaction, serverTimestamp, Timestamp, type DocumentData, type DocumentReference, type Transaction } from 'firebase/firestore';
import { firebaseAuth, firestore } from '../config/firebase';

export type BudgetWrite = { ref: DocumentReference<DocumentData>; data: DocumentData; update?: boolean };

function requireVerifiedUser() {
  const user = firebaseAuth.currentUser;
  if (!user || !user.emailVerified) throw new Error('Önce e-posta adresini doğrulamalısın.');
  return user;
}

function validateWrites(writes: BudgetWrite[]): void {
  if (!writes.length || writes.length > 2 || new Set(writes.map((w) => w.ref.path)).size !== writes.length) throw new Error('Geçersiz kayıt işlemi.');
}

/** Reads the daily budget and queues the charged writes. Must run after every other transaction read. */
async function chargeInTransaction(transaction: Transaction, uid: string, writes: BudgetWrite[]): Promise<void> {
  const budget = doc(firestore, 'write_limits', uid);
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
}

export async function budgetWrites(writes: BudgetWrite[]): Promise<void> {
  const user = requireVerifiedUser();
  validateWrites(writes);
  await runTransaction(firestore, (transaction) => chargeInTransaction(transaction, user.uid, writes));
}

/** Plan returned by a transactional unit of work. Charged writes (max 2) go through the daily budget; deletes are free. */
export type BudgetPlan<T> = { result: T; writes?: BudgetWrite[]; deletes?: DocumentReference<DocumentData>[] };

/** Runs reads and budget-charged writes in ONE transaction so read-modify-write cycles cannot overwrite each other.
 * `work` may run more than once (transaction retries) and must only read through the given transaction. */
export async function budgetTransaction<T>(work: (transaction: Transaction) => Promise<BudgetPlan<T>>): Promise<T> {
  const user = requireVerifiedUser();
  return runTransaction(firestore, async (transaction) => {
    const plan = await work(transaction);
    if (plan.writes?.length) {
      validateWrites(plan.writes);
      await chargeInTransaction(transaction, user.uid, plan.writes);
    }
    for (const ref of plan.deletes ?? []) transaction.delete(ref);
    return plan.result;
  });
}
export const limitedSet = (ref: DocumentReference<DocumentData>, data: DocumentData) => budgetWrites([{ ref, data }]);
export const limitedUpdate = (ref: DocumentReference<DocumentData>, data: DocumentData) => budgetWrites([{ ref, data, update: true }]);
