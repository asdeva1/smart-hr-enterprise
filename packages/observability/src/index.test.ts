import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './index.js';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });
  return { lines, stream };
}

describe('createLogger', () => {
  it('redacts credentials and personal identifiers', () => {
    const { lines, stream } = capture();
    const logger = createLogger({ service: 'test', destination: stream });

    logger.info(
      {
        password: 'p@ss',
        employee: { pan: 'ABCDE1234F', aadhaar: '123412341234', bankAccount: '0011223344', name: 'Asha' },
      },
      'profile updated',
    );

    const line = lines[0];
    expect(line).toBeDefined();
    expect(line?.password).toBe('[REDACTED]');
    expect(line?.employee).toEqual({
      pan: '[REDACTED]',
      aadhaar: '[REDACTED]',
      bankAccount: '[REDACTED]',
      name: 'Asha',
    });
  });

  it('labels levels as words and tags the service', () => {
    const { lines, stream } = capture();
    createLogger({ service: 'api', destination: stream }).warn('careful');
    expect(lines[0]).toMatchObject({ level: 'warn', service: 'api', msg: 'careful' });
  });
});
