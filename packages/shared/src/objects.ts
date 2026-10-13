/** `T` with every property optional and never explicitly `undefined`. */
export type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/**
 * Drops keys whose value is `undefined`, so a partial update only touches the fields the caller sent.
 * (`null` is kept: it means "clear this value".)
 */
export function defined<T extends object>(value: T): Defined<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Defined<T>;
}
