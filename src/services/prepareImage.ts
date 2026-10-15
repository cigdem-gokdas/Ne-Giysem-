import { Image } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

/** Re-encode selected images, bound dimensions, omit the original EXIF metadata. */
export async function prepareImage(uri: string, edge = 1600, base64 = false) {
  const size = await new Promise<{ width: number; height: number }>((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width < 1 || size.height < 1 || size.width * size.height > 100_000_000) throw new Error('Fotoğraf boyutları desteklenmiyor.');
  const scale = Math.min(1, edge / Math.max(size.width, size.height));
  return manipulateAsync(uri, [{ resize: { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) } }], { compress: 0.75, format: SaveFormat.JPEG, base64 });
}
