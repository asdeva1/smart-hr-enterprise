import { describe, expect, it } from 'vitest';
import { isUuid, isUuidV7, newId } from './ids.js';

describe('newId', () => {
  it('returns UUIDv7 values', () => {
    const id = newId();
    expect(isUuid(id)).toBe(true);
    expect(isUuidV7(id)).toBe(true);
  });

  it('sorts in creation order', () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
  });

  it('rejects other strings', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuidV7('3b241101-e2bb-4255-8caf-4136c566a962')).toBe(false);
  });
});
