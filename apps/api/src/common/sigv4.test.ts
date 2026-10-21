import { describe, expect, it } from 'vitest';
import { EMPTY_SHA256, signV4 } from './sigv4.js';

// The "GET Object" example from AWS's Signature Version 4 documentation for Amazon S3.
describe('signV4', () => {
  it('matches the published S3 example signature', () => {
    const headers = signV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      body: '',
      region: 'us-east-1',
      service: 's3',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      headers: { range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256 },
      doubleEncodePath: false,
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(headers).not.toHaveProperty('host');
    expect(headers['x-amz-date']).toBe('20130524T000000Z');
  });

  it('signs the session token when there is one', () => {
    const headers = signV4({
      method: 'PUT',
      url: new URL('https://b.s3.amazonaws.com/k'),
      body: 'x',
      region: 'ap-south-1',
      service: 's3',
      accessKeyId: 'AKIAFAKE',
      secretAccessKey: 'secret',
      sessionToken: 'tok',
      doubleEncodePath: false,
    });
    expect(headers['x-amz-security-token']).toBe('tok');
    expect(headers.authorization).toContain('x-amz-security-token');
  });
});
