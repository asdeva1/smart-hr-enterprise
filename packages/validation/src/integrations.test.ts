import { describe, expect, it } from 'vitest';
import { createWebhookSchema, isBlockedAddress, isBlockedHost } from './integrations.js';

describe('isBlockedHost', () => {
  it.each([
    'localhost',
    'app.localhost',
    'intranet',
    'printer.local',
    'db.internal',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '[::1]',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
  ])('blocks %s', (host) => {
    expect(isBlockedHost(host)).toBe(true);
  });

  it.each(['example.com', 'hooks.partner.co.in', '8.8.8.8', '172.32.0.1', '2606:4700::1111'])(
    'allows %s',
    (host) => {
      expect(isBlockedHost(host)).toBe(false);
    },
  );

  it('treats malformed addresses as blocked', () => {
    expect(isBlockedAddress('300.1.1.1')).toBe(true);
  });
});

describe('createWebhookSchema', () => {
  const ok = { name: 'HRIS sync', url: 'https://hooks.example.com/in', events: ['employee.created'] };

  it('accepts a public https address and removes repeated events', () => {
    const parsed = createWebhookSchema.parse({ ...ok, events: ['employee.created', 'employee.created'] });
    expect(parsed.events).toEqual(['employee.created']);
  });

  it.each([
    'http://hooks.example.com/in',
    'https://localhost/in',
    'https://10.0.0.5/in',
    'https://user:pw@hooks.example.com/in',
    'not a url',
  ])('rejects %s', (url) => {
    expect(createWebhookSchema.safeParse({ ...ok, url }).success).toBe(false);
  });

  it('needs at least one known event', () => {
    expect(createWebhookSchema.safeParse({ ...ok, events: [] }).success).toBe(false);
    expect(createWebhookSchema.safeParse({ ...ok, events: ['payroll.run'] }).success).toBe(false);
  });
});
