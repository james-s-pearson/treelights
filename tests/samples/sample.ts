// TypeScript sample for Treelights tests.
type Severity = "low" | "medium" | "high" | "critical";

interface Finding {
  id: number;
  severity: Severity;
  readonly tags?: string[];
}

enum Status { Open = 1, Closed }

export function triage<T extends Finding>(items: T[], min: Severity = "high"): Map<number, T> {
  const order: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  const out = new Map<number, T>();
  for (const item of items) {
    if (order[item.severity] >= order[min]) out.set(item.id, item as T);
  }
  return out;
}

export abstract class Store<K, V> implements Iterable<V> {
  private data = new Map<K, V>();
  protected abstract key(v: V): K;
  *[Symbol.iterator](): Iterator<V> { yield* this.data.values(); }
}
