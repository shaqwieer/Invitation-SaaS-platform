import pino from 'pino';
import { env } from '../config/env.js';

function defaultLevel(): pino.Level | 'silent' {
  const configured = env().LOG_LEVEL;
  if (configured) return configured;
  if (env().NODE_ENV === 'test') return 'silent';
  return env().NODE_ENV === 'production' ? 'info' : 'debug';
}

export const logger = pino({
  level: defaultLevel(),
  // pino-pretty is a devDependency; loading it in production would crash on a
  // slim image where devDependencies were pruned.
  transport:
    env().NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
      '*.code',
      '*.codeHash',
    ],
    censor: '[redacted]',
  },
});

export type Logger = typeof logger;
