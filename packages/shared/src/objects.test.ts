import { describe, expect, it } from 'vitest';
import { defined } from './objects.js';

describe('defined', () => {
  it('drops undefined but keeps null and falsy values', () => {
    expect(defined({ a: undefined, b: null, c: 0, d: '', e: false })).toEqual({
      b: null,
      c: 0,
      d: '',
      e: false,
    });
  });
});
