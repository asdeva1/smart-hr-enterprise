import { signupSchema } from '@smart-hr/validation';
import { describe, expect, it } from 'vitest';
import { readForm } from './form';

function formWith(values: Record<string, string>) {
  const form = document.createElement('form');
  for (const [name, value] of Object.entries(values)) {
    const input = document.createElement('input');
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  return form;
}

describe('readForm', () => {
  it('returns typed data for a valid form', () => {
    const r = readForm(
      formWith({ organisationName: 'Acme', displayName: 'Ira Buyer', email: 'ira@acme.example' }),
      signupSchema,
    );
    expect(r.errors).toBeNull();
    expect(r.data?.email).toBe('ira@acme.example');
  });

  it('returns a message per field, and treats blanks as missing', () => {
    const r = readForm(formWith({ organisationName: '  ', displayName: 'Ira', email: 'nope' }), signupSchema);
    expect(r.data).toBeNull();
    expect(Object.keys(r.errors ?? {}).sort()).toEqual(['email', 'organisationName']);
  });
});
