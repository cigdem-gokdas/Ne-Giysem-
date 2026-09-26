export type UploadState = { visible: boolean; label: string };
type Listener = (state: UploadState) => void;
const listeners = new Set<Listener>();
let active = 0;

export function subscribeUploadState(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(state: UploadState): void { listeners.forEach((listener) => listener(state)); }

export async function withUploadStatus<T>(label: string, task: () => Promise<T>): Promise<T> {
  active += 1;
  emit({ visible: true, label });
  try { return await task(); }
  finally {
    active = Math.max(0, active - 1);
    if (active === 0) emit({ visible: false, label: '' });
  }
}
