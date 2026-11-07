import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : v === 'true' || v === '1');

export interface Config {
  nodeEnv: string;
  port: number;
  databaseUrl?: string;
  pgliteDataDir: string;
  jwtSecret: string;
  mockWebhookSecret: string;
  corsOrigins: string[];
  paymentProvider: 'mock';
  /** Sandbox mode is always on in this build: there is no live payment adapter. */
  sandbox: true;
  otpDevEcho: boolean;
  minLeadMinutes: number;
  checkoutTtlSeconds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const prod = nodeEnv === 'production';
  const parsed = z
    .object({
      PORT: z.coerce.number().int().default(4000),
      PAYMENT_PROVIDER: z.string().default('mock'),
      MIN_LEAD_MINUTES: z.coerce.number().int().min(0).default(5),
      CHECKOUT_TTL_SECONDS: z.coerce.number().int().min(30).default(600),
    })
    .parse(env);

  if (parsed.PAYMENT_PROVIDER !== 'mock') {
    throw new Error(
      `PAYMENT_PROVIDER="${parsed.PAYMENT_PROVIDER}" is not available. Only the sandbox "mock" provider exists until ` +
        'provider approval, credentials and commercial terms are in place.',
    );
  }
  if (prod && (!env.JWT_SECRET || env.JWT_SECRET === 'replace-me')) throw new Error('JWT_SECRET is required in production');
  if (prod && (!env.MOCK_WEBHOOK_SECRET || env.MOCK_WEBHOOK_SECRET === 'replace-me'))
    throw new Error('MOCK_WEBHOOK_SECRET is required in production');

  const secretOrRandom = (v: string | undefined) => (v && v !== 'replace-me' ? v : crypto.randomBytes(32).toString('hex'));

  return {
    nodeEnv,
    port: parsed.PORT,
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDataDir: env.PGLITE_DATA_DIR || '.data/pglite',
    jwtSecret: secretOrRandom(env.JWT_SECRET),
    mockWebhookSecret: secretOrRandom(env.MOCK_WEBHOOK_SECRET),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174,http://localhost:5175')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    paymentProvider: 'mock',
    sandbox: true,
    otpDevEcho: bool(env.OTP_DEV_ECHO, !prod),
    minLeadMinutes: parsed.MIN_LEAD_MINUTES,
    checkoutTtlSeconds: parsed.CHECKOUT_TTL_SECONDS,
  };
}
