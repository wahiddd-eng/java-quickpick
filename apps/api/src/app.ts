import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { asyncHandler } from './auth.js';
import { Bus, HttpError, type AppContext } from './context.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { MockPaymentProvider } from './payments/mock.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { studentRoutes } from './routes/student.js';
import { vendorRoutes } from './routes/vendor.js';
import { makeSandboxDeliver, processWebhook } from './services/payments.js';

export function createContext(config: Config, db: Db, opts: { now?: () => Date } = {}): AppContext {
  const provider = new MockPaymentProvider(config.mockWebhookSecret);
  const ctx: AppContext = { config, db, bus: new Bus(), provider, now: opts.now ?? (() => new Date()) };
  // SANDBOX: this build has no live provider, so we can always stand in for it.
  ctx.sandboxDeliver = makeSandboxDeliver(ctx, (e) => provider.buildSignedEvent(e));
  return ctx;
}

export function createApp(ctx: AppContext) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: ctx.config.corsOrigins, credentials: false }));

  app.get('/health', asyncHandler(async (_req, res) => {
    await ctx.db.query('SELECT 1');
    res.json({ ok: true, sandbox: true, time: ctx.now().toISOString() });
  }));

  // Webhooks need the RAW body for signature verification, so they are mounted BEFORE express.json().
  app.post(
    '/api/v1/webhooks/payments/:provider',
    rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false, skip: () => process.env.VITEST === 'true' }),
    express.raw({ type: '*/*', limit: '100kb' }),
    asyncHandler(async (req, res) => {
      if (req.params.provider !== ctx.provider.name) throw new HttpError(404, 'UNKNOWN_PROVIDER', 'Unknown provider');
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const out = await processWebhook(ctx, raw, req.headers);
      res.status(200).json(out);
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  const api = express.Router();
  api.use(authRoutes(ctx));
  api.use(studentRoutes(ctx));
  api.use(vendorRoutes(ctx));
  api.use(adminRoutes(ctx));
  app.use('/api/v1', api);

  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Not found')));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) {
      return void res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
    }
    if (err?.type === 'entity.parse.failed') return void res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON' } });
    // Never leak internals or secrets; log only a safe summary.
    console.error('[error]', err?.code ?? '', err?.message ?? err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  };
  app.use(onError);
  return app;
}
