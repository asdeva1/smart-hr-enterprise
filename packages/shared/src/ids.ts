import { v7 as uuidv7, validate, version } from 'uuid';

/** Time-ordered UUIDv7: index-friendly primary keys that still don't leak sequential counts. */
export function newId(): string {
  return uuidv7();
}

export function isUuid(value: string): boolean {
  return validate(value);
}

export function isUuidV7(value: string): boolean {
  return validate(value) && version(value) === 7;
}
