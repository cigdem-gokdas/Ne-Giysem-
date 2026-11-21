export type UploadState = { visible: boolean; label: string };
type Listener = (state: UploadState) => void;
const listeners = new Set<Listener>();
let active = 0;
let suppressed = 0;
let current: UploadState = { visible: false, label: '' };

export function subscribeUploadState(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => { listeners.delete(listener); };
}

function emit(state: UploadState): void {
  current = state;
  listeners.forEach((listener) => listener(state));
}

/** Screens that already present their own Modal call this while it is open: iOS cannot show two modals at
 * once, so the global overlay stays hidden and the screen renders its own inline upload indicator.
 * Returns the release function. */
export function suppressUploadOverlay(): () => void {
  suppressed += 1;
  let released = false;
  return () => { if (!released) { released = true; suppressed = Math.max(0, suppressed - 1); } };
}

export function isUploadOverlaySuppressed(): boolean { return suppressed > 0; }

export async function withUploadStatus<T>(label: string, task: () => Promise<T>): Promise<T> {
  active += 1;
  // The overlay decision is made when the upload starts so it never pops up over a modal that opened first.
  emit({ visible: !isUploadOverlaySuppressed(), label });
  try { return await task(); }
  finally {
    active = Math.max(0, active - 1);
    if (active === 0) emit({ visible: false, label: '' });
  }
}
