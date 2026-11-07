import http from 'node:http';
import request from 'supertest';
import { createApp, createContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb, migrate } from '../src/db.js';
import { DEMO_PASSWORD, seedDemo } from '../src/seed.js';
import type { OrderNotification } from '../src/context.js';

/** Fixed, controllable clock: Monday 2026-11-09 10:30 IST. Demo shops are open 08:00–22:00 IST. */
export const START = new Date('2026-11-09T05:00:00Z');

export async function makeEnv() {
  const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: 'test-jwt-secret', MOCK_WEBHOOK_SECRET: 'test-webhook-secret' } as NodeJS.ProcessEnv);
  const db = await createDb(config, { memory: true });
  await migrate(db);
  await seedDemo(db);
  const clock = { t: new Date(START) };
  const ctx = createContext(config, db, { now: () => clock.t });
  const app = createApp(ctx);
  // One long-lived listener (instead of supertest binding a new server per call).
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const api = request(server);
  const notifications: OrderNotification[] = [];
  ctx.bus.onOrder((n) => notifications.push(n));

  const shops = (await api.get('/api/v1/shops')).body.shops as Array<{ id: string; name: string }>;
  const shopA = shops.find((s) => s.name === 'Demo Shop A')!;
  const shopB = shops.find((s) => s.name === 'Demo Shop B')!;
  const menu = async (shopId: string) => {
    const items = (await api.get(`/api/v1/shops/${shopId}/menu`)).body.items as Array<{ id: string; name: string; basePricePaise: number }>;
    return Object.fromEntries(items.map((i) => [i.name, i]));
  };

  const studentToken = async (email: string) => {
    const o = await api.post('/api/v1/auth/otp/request').send({ email });
    const v = await api.post('/api/v1/auth/otp/verify').send({ email, code: o.body.devCode, name: email.split('@')[0] });
    return v.body.token as string;
  };
  const staffToken = async (email: string) => (await api.post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })).body.token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let slotCursor = 0;
  /** Picks a distinct future slot each call so tests do not compete for capacity unless they want to. */
  const nextSlot = async (shopId: string) => {
    const slots = (await api.get(`/api/v1/shops/${shopId}/pickup-slots`)).body.slots as Array<{ id: string; full: boolean }>;
    return slots[(slotCursor++ % (slots.length - 2)) + 1];
  };

  let keySeq = 0;
  const createOrder = (token: string, shopId: string, slotId: string, items: Array<{ menuItemId: string; quantity: number }>, key = `key-${++keySeq}-${Date.now()}`) =>
    api.post('/api/v1/orders').set(auth(token)).set('Idempotency-Key', key).send({ shopId, slotId, items });

  const startCheckout = (token: string, orderId: string) => api.post('/api/v1/payments/checkout').set(auth(token)).send({ orderId });
  const simulate = (token: string, orderId: string, outcome: 'success' | 'failure') =>
    api.post('/api/v1/sandbox/payments/simulate').set(auth(token)).send({ orderId, outcome });

  /** Full happy-path up to "paid, awaiting vendor". */
  const placePaidOrder = async (token: string, shopId: string, itemName = 'Demo Veg Meal', quantity = 1) => {
    const m = await menu(shopId);
    const slot = await nextSlot(shopId);
    const created = await createOrder(token, shopId, slot.id, [{ menuItemId: m[itemName].id, quantity }]);
    const orderId = created.body.order.id as string;
    await startCheckout(token, orderId);
    const paid = await simulate(token, orderId, 'success');
    return { orderId, order: paid.body.order, slotId: slot.id };
  };

  const reserved = async (slotId: string) => Number((await db.query(`SELECT reserved_count FROM pickup_slots WHERE id=$1`, [slotId]))[0].reserved_count);

  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  };

  return { ctx, db, api, close, clock, notifications, shopA, shopB, menu, studentToken, staffToken, auth, nextSlot, createOrder, startCheckout, simulate, placePaidOrder, reserved };
}

export type Env = Awaited<ReturnType<typeof makeEnv>>;
