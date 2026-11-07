import { hashPassword } from './auth.js';
import type { Db } from './db.js';

export const DEMO_PASSWORD = 'demo1234';

/**
 * DEMO DATA ONLY. Every seeded shop is flagged is_demo and named "Demo ...". Accounts use a published demo password, so
 * this must never run against production (the CLI refuses when NODE_ENV=production).
 */
export async function seedDemo(db: Db) {
  const existing = await db.query(`SELECT 1 FROM users WHERE email='admin@quickpick.demo'`);
  if (existing[0]) return { seeded: false };
  const pw = await hashPassword(DEMO_PASSWORD);

  await db.tx(async (q) => {
    // Sandbox pricing policy: 7% fee, no tax, NOT approved (needs the CA's written opinion before any live use).
    await q.query(
      `INSERT INTO pricing_policies (version, fee_rate_bps, tax_mode, tax_rate_bps, approved, note)
       VALUES (1, 700, 'NONE', 0, false, 'Sandbox default. Tax treatment of the fee is NOT approved — awaiting CA opinion.')
       ON CONFLICT (version) DO NOTHING`,
    );
    await q.query(`INSERT INTO users (name, email, role, password_hash) VALUES ('Demo Super Admin','super@quickpick.demo','SUPER_ADMIN',$1), ('Demo Admin','admin@quickpick.demo','ADMIN',$1)`, [pw]);

    const shops: Array<{ name: string; desc: string; email: string; items: Array<[string, string, number]> }> = [
      {
        name: 'Demo Shop A', desc: 'Demo data — North Indian meals', email: 'vendor-a@quickpick.demo',
        items: [['Meals', 'Demo Veg Meal', 10000], ['Meals', 'Demo Paneer Rice Bowl', 14000], ['Snacks', 'Demo Samosa (2 pcs)', 3000], ['Drinks', 'Demo Masala Chai', 1500]],
      },
      {
        name: 'Demo Shop B', desc: 'Demo data — South Indian tiffin', email: 'vendor-b@quickpick.demo',
        items: [['Tiffin', 'Demo Masala Dosa', 6500], ['Tiffin', 'Demo Idli Plate (3)', 4000], ['Meals', 'Demo Curd Rice', 7000], ['Drinks', 'Demo Filter Coffee', 2000]],
      },
    ];

    let n = 1;
    for (const s of shops) {
      // Demo hours are wide so the sandbox can be tried at any time; the real pilot is lunch-only (set per shop in admin).
      const [shop] = await q.query(
        `INSERT INTO shops (name, description, status, open_time, close_time, slot_minutes, slot_capacity, accept_timeout_seconds, is_demo)
         VALUES ($1,$2,'ACTIVE','08:00','22:00',10,5,90,true) RETURNING id`,
        [s.name, s.desc],
      );
      const [u] = await q.query(`INSERT INTO users (name, email, role, password_hash) VALUES ($1,$2,'VENDOR',$3) RETURNING id`, [`${s.name} Owner`, s.email, pw]);
      await q.query(`INSERT INTO shop_members (user_id, shop_id, role) VALUES ($1,$2,'OWNER')`, [u.id, shop.id]);
      const cats = new Map<string, string>();
      let order = 0;
      for (const [cat, name, price] of s.items) {
        if (!cats.has(cat)) cats.set(cat, (await q.query(`INSERT INTO categories (shop_id, name, sort_order) VALUES ($1,$2,$3) RETURNING id`, [shop.id, cat, order++]))[0].id);
        await q.query(`INSERT INTO menu_items (shop_id, category_id, name, description, base_price_paise) VALUES ($1,$2,$3,'Demo item',$4)`, [shop.id, cats.get(cat), name, price]);
      }
      await q.query(`INSERT INTO devices (asset_tag, model, shop_id, status, assigned_at) VALUES ($1,'Demo tablet',$2,'LOANED',now())`, [`JQ-TAB-00${n++}`, shop.id]);
    }
  });
  return { seeded: true };
}
