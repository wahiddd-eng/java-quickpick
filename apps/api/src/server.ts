import http from 'node:http';
import { createApp, createContext } from './app.js';
import { loadConfig } from './config.js';
import { createDb, migrate } from './db.js';
import { attachRealtime } from './realtime.js';
import { expireStaleOrders } from './services/orders.js';
import { seedDemo } from './seed.js';

async function main() {
  const config = loadConfig();
  const db = await createDb(config);
  const ran = await migrate(db);
  if (ran.length) console.log('[db] applied migrations:', ran.join(', '));
  if (config.nodeEnv !== 'production') {
    const s = await seedDemo(db);
    if (s.seeded) console.log('[db] seeded DEMO data (see README for demo accounts)');
  }

  const ctx = createContext(config, db);
  const app = createApp(ctx);
  const server = http.createServer(app);
  attachRealtime(ctx, server);

  // Background sweeper: expire unpaid checkouts and unanswered orders (releases slots, refunds paid ones).
  const sweep = setInterval(() => {
    expireStaleOrders(ctx).catch((e) => console.error('[sweeper]', e?.message ?? e));
  }, 15_000);
  sweep.unref();

  server.listen(config.port, () => {
    console.log(`Java QuickPick API on http://localhost:${config.port}`);
    console.log('⚠  SANDBOX MODE — real payments are DISABLED (pending FSSAI / GST (CA) / payment-provider / SRM approvals).');
  });

  const shutdown = async () => {
    clearInterval(sweep);
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
