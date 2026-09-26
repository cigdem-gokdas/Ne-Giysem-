import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { firestore } from '../config/firebase';
import type { ClothingItem } from './wardrobe';

export type OutfitHistoryEntry = { id: string; createdAt: string; userMessage: string; assistantMessage: string; selectedIds: string[] };
export type WardrobeSummaryItem = { id: string; tur: string; renk: string; kesim: string; alt_tur: string; kemer_uygun: boolean; son_kullanim: number | 'hic'; kullanim_sayisi: number };

const MAIN_TYPES = new Set(['üst', 'alt', 'dış giyim']);

export function isMainClothingType(type: string): boolean {
  return MAIN_TYPES.has(type.trim().toLocaleLowerCase('tr-TR'));
}

export async function getOutfitHistory(userId: string): Promise<OutfitHistoryEntry[]> {
  const rows = await getDocs(query(collection(firestore, 'outfit_history'), where('userId', '==', userId)));
  return rows.docs.map((snapshot) => ({
    id: snapshot.id,
    createdAt: snapshot.data().createdAt,
    userMessage: snapshot.data().userMessage,
    assistantMessage: snapshot.data().assistantMessage,
    selectedIds: snapshot.data().selectedIds ?? [],
  })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function clearOutfitHistory(userId: string): Promise<void> {
  const rows = await getDocs(query(collection(firestore, 'outfit_history'), where('userId', '==', userId)));
  await Promise.all(rows.docs.map((snapshot) => deleteDoc(snapshot.ref)));
}

export async function saveOutfitHistoryEntry(userId: string, entry: Omit<OutfitHistoryEntry, 'id' | 'createdAt'>): Promise<OutfitHistoryEntry> {
  const ref = doc(collection(firestore, 'outfit_history'));
  const saved = { ...entry, id: ref.id, createdAt: new Date().toISOString() };
  await setDoc(ref, { userId, createdAt: saved.createdAt, userMessage: saved.userMessage, assistantMessage: saved.assistantMessage, selectedIds: saved.selectedIds });
  return saved;
}

export function buildWardrobeSummary(wardrobe: ClothingItem[], history: OutfitHistoryEntry[]): WardrobeSummaryItem[] {
  const lastIndex = new Map<string, number>();
  const usageCount = new Map<string, number>();
  history.forEach((entry, index) => entry.selectedIds.forEach((id) => {
    lastIndex.set(id, index);
    usageCount.set(id, (usageCount.get(id) ?? 0) + 1);
  }));
  return wardrobe.map(({ id, tags }) => ({
    id,
    tur: tags.tur,
    renk: tags.renk,
    kesim: tags.kesim ?? 'bilinmiyor',
    alt_tur: tags.altTur ?? 'diğer',
    kemer_uygun: tags.kemerUygun ?? tags.altTur === 'pantolon',
    son_kullanim: lastIndex.has(id) ? history.length - 1 - lastIndex.get(id)! : 'hic',
    kullanim_sayisi: usageCount.get(id) ?? 0,
  }));
}

export function hasAvailableMainPiece(summary: WardrobeSummaryItem[]): boolean {
  return summary.some(({ tur, son_kullanim }) => isMainClothingType(tur) && (son_kullanim === 'hic' || son_kullanim >= 5));
}
