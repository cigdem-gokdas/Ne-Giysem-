import { Image } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'jpeg-js';
import { base64ToBytes } from '../utils/base64';
import { boxToCropRect, findSubjectBox, suggestCrop, type NormalizedBox } from '../utils/subjectBox';
import { reportError } from './telemetry';

const WORK_EDGE = 1600;
const ANALYSIS_EDGE = 96;

export type CropReason = 'ok' | 'no_size' | 'no_thumb' | 'no_subject' | 'skip_rule' | 'invalid_box' | 'error';
export type CropResult = { uri: string; cropped: boolean; reason: CropReason };

function imageSize(uri: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
}

const discard = (uri: string | undefined) => uri ? FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined) : Promise.resolve();

/** Crops the full-resolution photo to an AI-provided normalized box (0-1, top-left origin). Never throws. */
export async function cropToBox(uri: string, box: NormalizedBox | null | undefined, { padding = 0.06 }: { padding?: number } = {}): Promise<CropResult> {
  try {
    const size = await imageSize(uri);
    if (!(size.width > 0 && size.height > 0)) return { uri, cropped: false, reason: 'no_size' };
    const { rect, reason } = boxToCropRect(box, size.width, size.height, { padding, skipAbove: 0.95 });
    if (!rect) return { uri, cropped: false, reason };
    const result = await manipulateAsync(uri, [{ crop: rect }], { compress: 0.9, format: SaveFormat.JPEG });
    return { uri: result.uri, cropped: true, reason: 'ok' };
  } catch (error) {
    reportError('smart_crop', error);
    return { uri, cropped: false, reason: 'error' };
  }
}

/**
 * On-device fallback: trims the plain background around a clothing photo and crops around the garment with balanced padding.
 * Never throws: if anything is unexpected (busy background, decode failure, ...) the original photo is returned.
 */
export async function smartCropClothing(uri: string): Promise<CropResult> {
  let workUri: string | undefined;
  let thumbUri: string | undefined;
  try {
    const original = await imageSize(uri);
    if (!(original.width > 0 && original.height > 0)) return { uri, cropped: false, reason: 'no_size' };
    // A bounded, EXIF-normalised working copy; its reported size is always the true orientation.
    const scale = Math.min(1, WORK_EDGE / Math.max(original.width, original.height));
    const work = await manipulateAsync(uri, [{ resize: { width: Math.max(1, Math.round(original.width * scale)) } }], { compress: 0.9, format: SaveFormat.JPEG });
    workUri = work.uri;
    const thumbScale = Math.min(1, ANALYSIS_EDGE / Math.max(work.width, work.height));
    const thumb = await manipulateAsync(work.uri, [{ resize: { width: Math.max(8, Math.round(work.width * thumbScale)) } }], { compress: 0.8, format: SaveFormat.JPEG, base64: true });
    thumbUri = thumb.uri;
    if (!thumb.base64) return { uri, cropped: false, reason: 'no_thumb' };
    // useTArray avoids the Node-only Buffer, which does not exist in React Native.
    const pixels = decode(base64ToBytes(thumb.base64), { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 4 });
    const subject = findSubjectBox(pixels.data, pixels.width, pixels.height);
    if (!subject) return { uri, cropped: false, reason: 'no_subject' };
    const crop = suggestCrop(subject, pixels.width, pixels.height);
    if (!crop) return { uri, cropped: false, reason: 'skip_rule' };
    const fx = work.width / pixels.width;
    const fy = work.height / pixels.height;
    const originX = Math.max(0, Math.round(crop.left * fx));
    const originY = Math.max(0, Math.round(crop.top * fy));
    const result = await manipulateAsync(work.uri, [{ crop: {
      originX, originY,
      width: Math.max(1, Math.min(work.width - originX, Math.round(crop.width * fx))),
      height: Math.max(1, Math.min(work.height - originY, Math.round(crop.height * fy))),
    } }], { compress: 0.9, format: SaveFormat.JPEG });
    return { uri: result.uri, cropped: true, reason: 'ok' };
  } catch (error) {
    reportError('smart_crop', error);
    return { uri, cropped: false, reason: 'error' };
  } finally {
    await discard(thumbUri);
    await discard(workUri);
  }
}
