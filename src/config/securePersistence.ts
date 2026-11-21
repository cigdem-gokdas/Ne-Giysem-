import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const INSTALL_MARKER = 'negiysem.secure-auth-install';
type Manifest = { version: string; chunks: number };
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const task = queue.then(operation, operation);
  queue = task.catch(() => undefined);
  return task;
}
async function storageKey(key: string) {
  let install = await AsyncStorage.getItem(INSTALL_MARKER);
  if (!install) { install = Crypto.randomUUID(); await AsyncStorage.setItem(INSTALL_MARKER, install); }
  return `firebase_${install}_${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key)}`;
}
class CorruptSessionError extends Error {}
async function manifest(key: string): Promise<Manifest | null> {
  const text = await SecureStore.getItemAsync(key, options);
  if (!text) return null;
  try {
    const data = JSON.parse(text) as Manifest;
    if (!/^[a-f0-9-]{36}$/.test(data.version) || !Number.isInteger(data.chunks) || data.chunks < 1 || data.chunks > 256) throw new Error('invalid');
    return data;
  } catch { throw new CorruptSessionError('Güvenli oturum kaydı okunamadı.'); }
}
/** A corrupt manifest must never brick app start: drop the persisted auth chunks and continue signed out. */
async function resetCorrupt(key: string) {
  try {
    const text = await SecureStore.getItemAsync(key, options);
    const data = text ? JSON.parse(text) as Partial<Manifest> : null;
    if (data && typeof data.version === 'string' && /^[a-f0-9-]{36}$/.test(data.version)) {
      const count = Number.isInteger(data.chunks) ? Math.min(Math.max(data.chunks as number, 1), 256) : 256;
      for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${key}_${data.version}_${i}`, options).catch(() => undefined);
    }
  } catch { /* unreadable manifest: nothing more can be derived from it */ }
  await SecureStore.deleteItemAsync(key, options).catch(() => undefined);
}
async function safeManifest(key: string): Promise<Manifest | null> {
  try { return await manifest(key); }
  catch (error) { if (error instanceof CorruptSessionError) { await resetCorrupt(key); return null; } throw error; }
}
async function removeChunks(key: string, data: Manifest | null) {
  if (data) for (let i=0;i<data.chunks;i++) await SecureStore.deleteItemAsync(`${key}_${data.version}_${i}`, options);
}
async function write(key: string, value: string) {
  const previous = await safeManifest(key);
  const next = { version: Crypto.randomUUID(), chunks: Math.ceil(value.length / 500) };
  if (!next.chunks || next.chunks > 256) throw new Error('Oturum kaydı boyutu desteklenmiyor.');
  try {
    for (let i=0;i<next.chunks;i++) await SecureStore.setItemAsync(`${key}_${next.version}_${i}`, value.slice(i*500,(i+1)*500), options);
    // Publish only after all chunks are stored, leaving the previous session intact on failure.
    await SecureStore.setItemAsync(key, JSON.stringify(next), options);
  } catch (error) { await removeChunks(key, next).catch(() => undefined); throw error; }
  await removeChunks(key, previous);
}
export const securePersistence = {
  getItem: (key: string) => serialized(async () => {
    const safeKey = await storageKey(key);
    const data = await safeManifest(safeKey);
    if (data) {
      let result = '';
      for (let i=0;i<data.chunks;i++) {
        const part = await SecureStore.getItemAsync(`${safeKey}_${data.version}_${i}`, options);
        if (part === null) { await resetCorrupt(safeKey); return null; } // missing chunk: same self-repair as a corrupt manifest
        result += part;
      }
      return result;
    }
    const legacy = await AsyncStorage.getItem(key);
    if (legacy) { await write(safeKey, legacy); await AsyncStorage.removeItem(key); }
    return legacy;
  }),
  setItem: (key: string, value: string) => serialized(async () => {
    await write(await storageKey(key), value);
    await AsyncStorage.removeItem(key);
  }),
  removeItem: (key: string) => serialized(async () => {
    const safeKey = await storageKey(key), previous = await safeManifest(safeKey);
    await SecureStore.deleteItemAsync(safeKey, options);
    await removeChunks(safeKey, previous);
    await AsyncStorage.removeItem(key);
  }),
};
