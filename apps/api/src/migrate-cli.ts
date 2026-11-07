import { loadConfig } from './config.js';
import { createDb, migrate } from './db.js';

const db = await createDb(loadConfig());
const ran = await migrate(db);
console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.');
await db.close();
