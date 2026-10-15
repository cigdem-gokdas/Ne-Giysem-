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
async function manifest(key: string): Promise<Manifest | null> {
  const text = await SecureStore.getItemAsync(key, options);
  if (!text) return null;
  const data = JSON.parse(text) as Manifest;
  if (!/^[a-f0-9-]{36}$/.test(data.version) || !Number.isInteger(data.chunks) || data.chunks < 1 || data.chunks > 256) throw new Error('Güvenli oturum kaydı okunamadı.');
  return data;
}
async function removeChunks(key: string, data: Manifest | null) {
  if (data) for (let i=0;i<data.chunks;i++) await SecureStore.deleteItemAsync(`${key}_${data.version}_${i}`, options);
}
async function write(key: string, value: string) {
  const previous = await manifest(key);
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
    const data = await manifest(safeKey);
    if (data) {
      let result = '';
      for (let i=0;i<data.chunks;i++) {
        const part = await SecureStore.getItemAsync(`${safeKey}_${data.version}_${i}`, options);
        if (part === null) throw new Error('Güvenli oturum kaydı eksik.');
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
    const safeKey = await storageKey(key), previous = await manifest(safeKey);
    await SecureStore.deleteItemAsync(safeKey, options);
    await removeChunks(safeKey, previous);
    await AsyncStorage.removeItem(key);
  }),
};
