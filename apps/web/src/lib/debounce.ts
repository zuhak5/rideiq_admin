export function debounce<T extends (...args: unknown[]) => void>(fn: T, waitMs: number): (...args: Parameters<T>) => void {
  let t: number | null = null;

  return (...args: Parameters<T>) => {
    if (t != null) window.clearTimeout(t);
    t = window.setTimeout(() => {
      t = null;
      fn(...args);
    }, waitMs);
  };
}
