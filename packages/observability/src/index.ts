import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export type { Logger };

/**
 * Paths removed from every log line. Covers credentials and Indian identity / bank data.
 * Wildcards match one level; keep this list in sync with the data classification in docs/security.
 */
export const REDACT_PATHS = [
  'password',
  '*.password',
  'newPassword',
  '*.newPassword',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'apiKey',
  '*.apiKey',
  'secret',
  '*.secret',
  '*.pan',
  '*.aadhaar',
  '*.bankAccount',
  '*.bankAccountNumber',
  '*.salary',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
] as const;

export interface CreateLoggerOptions {
  service: string;
  level?: LoggerOptions['level'];
  /** Extra fields bound to every line, e.g. deployment mode. */
  base?: Record<string, unknown>;
  destination?: DestinationStream;
}

export function createLogger({
  service,
  level = 'info',
  base = {},
  destination,
}: CreateLoggerOptions): Logger {
  const options: LoggerOptions = {
    level,
    base: { service, ...base },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
    formatters: {
      level: (label) => ({ level: label }),
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
