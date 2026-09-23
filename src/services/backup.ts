import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as SQLite from 'expo-sqlite';
import JSZip from 'jszip';
import { closeDB, getDB, initDB } from '../data/database';

const BACKUP_FORMAT = 'ne-giysem-backup';
const BACKUP_VERSION = 1;
const DATABASE_ENTRY = 'database/ne-giysem.db';
const MANIFEST_ENTRY = 'manifest.json';
const MAX_BACKUP_BYTES = 1_500_000_000;
const MAX_MEDIA_FILES = 5_000;

const MEDIA_ROOTS = ['wardrobe-photos', 'outfit-gallery', 'profile-avatars'] as const;
type MediaRoot = typeof MEDIA_ROOTS[number];

export type BackupProgress = {
  label: string;
  progress?: number;
};

type ProgressCallback = (progress: BackupProgress) => void;

type BackupMediaFile = {
  archivePath: string;
  originalUri: string;
  size: number;
};

type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  database: { archivePath: typeof DATABASE_ENTRY; size: number };
  media: BackupMediaFile[];
};

type CollectedFile = BackupMediaFile & { file: File };

export type RestoreResult = 'cancelled' | 'restored';

function restoreError(cause: unknown): Error {
  if (cause instanceof Error && /^(Yedek|Yedekte|Seçilen|Bu yedek|Bu cihazda|Veritabanı|Geri yükleme)/.test(cause.message)) {
    return cause;
  }
  return new Error('Seçilen dosya bozuk, eksik veya geçerli bir Ne giysem? yedeği değil.');
}

function safeDeleteFile(file: File): void {
  try { if (file.exists) file.delete(); } catch { /* Temporary file cleanup is best effort. */ }
}

function safeDeleteDirectory(directory: Directory): void {
  try { if (directory.exists) directory.delete(); } catch { /* Temporary directory cleanup is best effort. */ }
}

function ensureDirectory(directory: Directory): void {
  directory.create({ idempotent: true, intermediates: true });
}

function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\')) return false;
  return path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function archiveRoot(path: string): MediaRoot | null {
  for (const root of MEDIA_ROOTS) {
    if (path.startsWith(`photos/${root}/`)) return root;
  }
  return null;
}

function archiveRelativePath(path: string, root: MediaRoot): string {
  return path.slice(`photos/${root}/`.length);
}

function collectDirectoryFiles(directory: Directory, root: MediaRoot, relative = ''): CollectedFile[] {
  if (!directory.exists) return [];
  return directory.list().flatMap((entry): CollectedFile[] => {
    const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry instanceof Directory) return collectDirectoryFiles(entry, root, relativePath);
    return [{
      archivePath: `photos/${root}/${relativePath}`,
      originalUri: entry.uri,
      size: entry.size,
      file: entry,
    }];
  });
}

function parseManifest(text: string): BackupManifest {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error('Seçilen dosya geçerli bir Ne giysem? yedeği değil.'); }

  if (!value || typeof value !== 'object') throw new Error('Yedek bilgileri okunamadı.');
  const candidate = value as Partial<BackupManifest>;
  if (candidate.format !== BACKUP_FORMAT || candidate.version !== BACKUP_VERSION) {
    throw new Error('Bu yedek sürümü uygulama tarafından desteklenmiyor.');
  }
  if (!candidate.database || candidate.database.archivePath !== DATABASE_ENTRY || !Number.isSafeInteger(candidate.database.size) || candidate.database.size <= 0) {
    throw new Error('Yedekte geçerli bir veritabanı bulunamadı.');
  }
  if (!Array.isArray(candidate.media) || candidate.media.length > MAX_MEDIA_FILES) {
    throw new Error('Yedekteki fotoğraf listesi geçersiz veya çok büyük.');
  }

  const paths = new Set<string>();
  let totalSize = candidate.database.size;
  for (const item of candidate.media) {
    if (!item || typeof item.archivePath !== 'string' || item.archivePath.length > 600 ||
        typeof item.originalUri !== 'string' || item.originalUri.length > 4_096 ||
        !Number.isSafeInteger(item.size) || item.size < 0 || !isSafeRelativePath(item.archivePath) ||
        !archiveRoot(item.archivePath) || paths.has(item.archivePath)) {
      throw new Error('Yedekte güvenli olmayan bir fotoğraf kaydı bulundu.');
    }
    paths.add(item.archivePath);
    totalSize += item.size;
    if (totalSize > MAX_BACKUP_BYTES) throw new Error('Yedek dosyası bu cihazda işlenemeyecek kadar büyük.');
  }
  return candidate as BackupManifest;
}

async function validateDatabase(bytes: Uint8Array): Promise<void> {
  let temporary: SQLite.SQLiteDatabase | null = null;
  try {
    temporary = await SQLite.deserializeDatabaseAsync(bytes, { useNewConnection: true });
    const integrity = await temporary.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
    if (integrity?.integrity_check !== 'ok') throw new Error('Veritabanı bütünlük kontrolünü geçemedi.');
    const users = await temporary.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", 'users',
    );
    if (!users) throw new Error('Yedekte kullanıcı veritabanı bulunamadı.');
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('Yedekte')) throw cause;
    throw new Error('Yedekteki veritabanı bozuk veya okunamıyor.');
  } finally {
    if (temporary) await temporary.closeAsync().catch(() => undefined);
  }
}

function createTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

export async function exportBackup(onProgress: ProgressCallback): Promise<void> {
  const output = new File(Paths.cache, `ne-giysem-yedek_${createTimestamp()}.negiysem`);
  try {
    onProgress({ label: 'Veritabanı hazırlanıyor…', progress: 0.02 });
    const db = await getDB();
    const databaseBytes = await db.serializeAsync();
    const files = MEDIA_ROOTS.flatMap((root) =>
      collectDirectoryFiles(new Directory(Paths.document, root), root),
    );
    const totalSize = files.reduce((sum, item) => sum + item.size, databaseBytes.byteLength);
    if (files.length > MAX_MEDIA_FILES || totalSize > MAX_BACKUP_BYTES) {
      throw new Error('Yedek bu cihazda tek parça olarak oluşturulamayacak kadar büyük.');
    }

    const zip = new JSZip();
    zip.file(DATABASE_ENTRY, databaseBytes, { binary: true, compression: 'STORE' });
    for (let index = 0; index < files.length; index += 1) {
      const item = files[index];
      onProgress({
        label: `Fotoğraflar hazırlanıyor (${index + 1}/${files.length})…`,
        progress: files.length ? 0.05 + ((index + 1) / files.length) * 0.55 : 0.6,
      });
      zip.file(item.archivePath, await item.file.bytes(), { binary: true, compression: 'STORE' });
    }

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      database: { archivePath: DATABASE_ENTRY, size: databaseBytes.byteLength },
      media: files.map(({ file: _file, ...entry }) => entry),
    };
    zip.file(MANIFEST_ENTRY, JSON.stringify(manifest, null, 2));
    const archiveBytes = await zip.generateAsync(
      { type: 'uint8array', compression: 'STORE', platform: 'UNIX' },
      ({ percent }) => onProgress({ label: 'Yedek dosyası paketleniyor…', progress: 0.6 + (percent / 100) * 0.38 }),
    );
    output.create({ overwrite: true, intermediates: true });
    output.write(archiveBytes);

    if (!(await Sharing.isAvailableAsync())) throw new Error('Bu cihazda dosya paylaşımı kullanılamıyor.');
    onProgress({ label: 'Kaydetme seçenekleri açılıyor…', progress: 1 });
    await Sharing.shareAsync(output.uri, {
      dialogTitle: 'Ne giysem? yedeğini kaydet',
      mimeType: 'application/zip',
      UTI: 'public.zip-archive',
    });
  } finally {
    safeDeleteFile(output);
  }
}

async function updateRestoredMediaUris(manifest: BackupManifest): Promise<void> {
  const db = await getDB();
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const item of manifest.media) {
      const root = archiveRoot(item.archivePath);
      if (!root) continue;
      const relative = archiveRelativePath(item.archivePath, root);
      const restoredUri = new File(Paths.document, root, ...relative.split('/')).uri;
      if (root === 'wardrobe-photos') {
        await tx.runAsync('UPDATE wardrobe SET imageUri = ? WHERE imageUri = ?', restoredUri, item.originalUri);
      } else if (root === 'outfit-gallery') {
        await tx.runAsync('UPDATE gallery SET imageUri = ? WHERE imageUri = ?', restoredUri, item.originalUri);
      } else {
        await tx.runAsync(
          'UPDATE users SET avatar_uri = CASE WHEN avatar_uri = ? THEN ? ELSE avatar_uri END, avatarUri = CASE WHEN avatarUri = ? THEN ? ELSE avatarUri END WHERE avatar_uri = ? OR avatarUri = ?',
          item.originalUri, restoredUri, item.originalUri, restoredUri, item.originalUri, item.originalUri,
        );
      }
    }
  });
}

async function rollbackRestore(databasePath: string, oldDatabaseBytes: Uint8Array, rollbackRoot: Directory): Promise<void> {
  await closeDB().catch(() => undefined);
  const databaseFile = new File(databasePath);
  databaseFile.write(oldDatabaseBytes);
  safeDeleteFile(new File(`${databasePath}-wal`));
  safeDeleteFile(new File(`${databasePath}-shm`));
  for (const root of MEDIA_ROOTS) {
    const live = new Directory(Paths.document, root);
    safeDeleteDirectory(live);
    const saved = new Directory(rollbackRoot, root);
    if (saved.exists) await saved.move(live);
  }
  await initDB();
}

export async function importBackup(onProgress: ProgressCallback): Promise<RestoreResult> {
  const selection = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (selection.canceled) return 'cancelled';
  if (!selection.assets[0]?.uri) throw new Error('Seçilen yedek dosyası okunamadı.');

  const stagingRoot = new Directory(Paths.cache, `ne-giysem-restore-${Date.now()}`);
  const rollbackRoot = new Directory(Paths.cache, `ne-giysem-rollback-${Date.now()}`);
  let replacementStarted = false;
  let keepRollbackFiles = false;
  let databasePath = '';
  let oldDatabaseBytes: Uint8Array | null = null;

  try {
    const selected = new File(selection.assets[0].uri);
    if (selected.size <= 0 || selected.size > MAX_BACKUP_BYTES) throw new Error('Seçilen yedek dosyasının boyutu geçersiz.');
    onProgress({ label: 'Yedek dosyası doğrulanıyor…', progress: 0.03 });
    const zip = await JSZip.loadAsync(await selected.bytes(), { checkCRC32: true, createFolders: true });
    const manifestFile = zip.file(MANIFEST_ENTRY);
    const databaseEntry = zip.file(DATABASE_ENTRY);
    if (!manifestFile || !databaseEntry) throw new Error('Yedek dosyasının temel bölümleri eksik.');
    const manifest = parseManifest(await manifestFile.async('text'));

    const allowedFiles = new Set([MANIFEST_ENTRY, DATABASE_ENTRY, ...manifest.media.map((item) => item.archivePath)]);
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.unsafeOriginalName && entry.unsafeOriginalName !== path) {
        throw new Error('Yedek dosyasında güvenli olmayan bir dosya yolu bulundu.');
      }
      if (!entry.dir && (!isSafeRelativePath(path) || !allowedFiles.has(path))) {
        throw new Error('Yedek dosyasında beklenmeyen veya güvenli olmayan içerik bulundu.');
      }
    }

    const databaseBytes = await databaseEntry.async('uint8array');
    if (databaseBytes.byteLength !== manifest.database.size) throw new Error('Yedekteki veritabanı eksik veya bozuk.');
    await validateDatabase(databaseBytes);

    ensureDirectory(stagingRoot);
    for (const root of MEDIA_ROOTS) ensureDirectory(new Directory(stagingRoot, root));
    for (let index = 0; index < manifest.media.length; index += 1) {
      const item = manifest.media[index];
      const entry = zip.file(item.archivePath);
      if (!entry) throw new Error(`Yedekte bir fotoğraf eksik: ${item.archivePath}`);
      const root = archiveRoot(item.archivePath);
      if (!root) throw new Error('Yedekte geçersiz bir fotoğraf yolu bulundu.');
      const relativeParts = archiveRelativePath(item.archivePath, root).split('/');
      const parent = new Directory(stagingRoot, root, ...relativeParts.slice(0, -1));
      ensureDirectory(parent);
      const bytes = await entry.async('uint8array');
      if (bytes.byteLength !== item.size) throw new Error(`Yedekteki bir fotoğraf bozuk: ${relativeParts.at(-1)}`);
      const destination = new File(parent, relativeParts.at(-1)!);
      destination.create({ overwrite: true, intermediates: true });
      destination.write(bytes);
      onProgress({
        label: `Fotoğraflar doğrulanıyor (${index + 1}/${manifest.media.length})…`,
        progress: manifest.media.length ? 0.12 + ((index + 1) / manifest.media.length) * 0.56 : 0.68,
      });
    }

    onProgress({ label: 'Mevcut veriler güvenle değiştiriliyor…', progress: 0.72 });
    const current = await getDB();
    databasePath = current.databasePath;
    oldDatabaseBytes = await current.serializeAsync();
    await closeDB();
    replacementStarted = true;
    ensureDirectory(rollbackRoot);

    for (const root of MEDIA_ROOTS) {
      const live = new Directory(Paths.document, root);
      if (live.exists) await live.move(new Directory(rollbackRoot, root));
    }
    const databaseFile = new File(databasePath);
    databaseFile.write(databaseBytes);
    safeDeleteFile(new File(`${databasePath}-wal`));
    safeDeleteFile(new File(`${databasePath}-shm`));
    for (const root of MEDIA_ROOTS) {
      const staged = new Directory(stagingRoot, root);
      await staged.move(new Directory(Paths.document, root));
    }

    onProgress({ label: 'Fotoğraf yolları yenileniyor…', progress: 0.9 });
    await initDB();
    await updateRestoredMediaUris(manifest);
    onProgress({ label: 'Geri yükleme tamamlandı.', progress: 1 });
    safeDeleteDirectory(rollbackRoot);
    return 'restored';
  } catch (cause) {
    if (replacementStarted && databasePath && oldDatabaseBytes) {
      try { await rollbackRestore(databasePath, oldDatabaseBytes, rollbackRoot); }
      catch {
        keepRollbackFiles = true;
        throw new Error('Geri yükleme tamamlanamadı. Uygulamayı kapatıp yeniden açarak tekrar dene.');
      }
    }
    throw restoreError(cause);
  } finally {
    safeDeleteDirectory(stagingRoot);
    if (!keepRollbackFiles) safeDeleteDirectory(rollbackRoot);
  }
}
