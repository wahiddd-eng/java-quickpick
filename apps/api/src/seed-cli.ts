import { loadConfig } from './config.js';
import { createDb, migrate } from './db.js';
import { seedDemo } from './seed.js';

const config = loadConfig();
if (config.nodeEnv === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}
const db = await createDb(config);
await migrate(db);
const r = await seedDemo(db);
console.log(r.seeded ? 'Seeded DEMO data.' : 'Demo data already present.');
await db.close();
