import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, hashPassword, requireRole } from '../auth.js';
import { HttpError, audit, istDate, istDayRange, withTx, type AppContext } from '../context.js';
import { initiateRefund } from '../services/ledger.js';
import { selectOrders } from '../services/orders.js';
import { policyRowToView } from '../services/pricing.js';

const uuid = z.string().uuid();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const shopFields = {
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  openTime: hhmm,
  closeTime: hhmm,
  slotMinutes: z.number().int().min(5).max(60),
  slotCapacity: z.number().int().min(0).max(100),
  acceptTimeoutSeconds: z.number().int().min(10).max(900),
  fssaiNumber: z.string().max(40).nullable(),
  ownerContact: z.string().max(200).nullable(),
  status: z.enum(['DRAFT', 'ACTIVE', 'SUSPENDED']),
  acceptingOrders: z.boolean(),
  isDemo: z.boolean(),
};

const shopRow = (s: any) => ({
  id: s.id,
  name: s.name,
  description: s.description,
  status: s.status,
  acceptingOrders: s.accepting_orders,
  openTime: s.open_time,
  closeTime: s.close_time,
  slotMinutes: s.slot_minutes,
  slotCapacity: s.slot_capacity,
  acceptTimeoutSeconds: s.accept_timeout_seconds,
  fssaiNumber: s.fssai_number,
  ownerContact: s.owner_contact,
  isDemo: s.is_demo,
});

const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function adminRoutes(ctx: AppContext): Router {
  const r = Router();
  r.use('/admin', requireRole(ctx, 'ADMIN'));
  const actor = (req: any) => ({ id: req.auth.id, role: req.auth.role });

  // ----- shops -----
  r.get(
    '/admin/shops',
    asyncHandler(async (_req, res) => {
      res.json({ shops: (await ctx.db.query(`SELECT * FROM shops ORDER BY name`)).map(shopRow) });
    }),
  );

  r.post(
    '/admin/shops',
    asyncHandler(async (req, res) => {
      const b = z
        .object({
          name: shopFields.name,
          description: shopFields.description.default(''),
          openTime: shopFields.openTime.default('11:30'),
          closeTime: shopFields.closeTime.default('15:00'),
          slotMinutes: shopFields.slotMinutes.default(10),
          slotCapacity: shopFields.slotCapacity.default(5),
          acceptTimeoutSeconds: shopFields.acceptTimeoutSeconds.default(90),
          fssaiNumber: shopFields.fssaiNumber.default(null),
          ownerContact: shopFields.ownerContact.default(null),
          isDemo: shopFields.isDemo.default(false),
        })
        .parse(req.body);
      const shop = await withTx(ctx, async (tx) => {
        const [s] = await tx.q.query(
          `INSERT INTO shops (name, description, open_time, close_time, slot_minutes, slot_capacity, accept_timeout_seconds, fssai_number, owner_contact, is_demo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [b.name, b.description, b.openTime, b.closeTime, b.slotMinutes, b.slotCapacity, b.acceptTimeoutSeconds, b.fssaiNumber, b.ownerContact, b.isDemo],
        );
        await audit(tx.q, actor(req), 'SHOP_CREATED', 'shop', s.id, { name: b.name });
        return s;
      });
      res.status(201).json({ shop: shopRow(shop) });
    }),
  );

  r.patch(
    '/admin/shops/:shopId',
    asyncHandler(async (req, res) => {
      if (!uuid.safeParse(req.params.shopId).success) throw new HttpError(404, 'SHOP_NOT_FOUND', 'Shop not found');
      const b = z.object(shopFields).partial().strict().parse(req.body);
      const cols: Record<string, string> = {
        name: 'name', description: 'description', openTime: 'open_time', closeTime: 'close_time', slotMinutes: 'slot_minutes', slotCapacity: 'slot_capacity',
        acceptTimeoutSeconds: 'accept_timeout_seconds', fssaiNumber: 'fssai_number', ownerContact: 'owner_contact', status: 'status', acceptingOrders: 'accepting_orders', isDemo: 'is_demo',
      };
      const sets: string[] = [];
      const params: unknown[] = [req.params.shopId];
      for (const [k, v] of Object.entries(b)) {
        params.push(v);
        sets.push(`${cols[k]}=$${params.length}`);
      }
      if (sets.length === 0) throw new HttpError(400, 'NO_CHANGES', 'Nothing to update');
      const shop = await withTx(ctx, async (tx) => {
        const rows = await tx.q.query(`UPDATE shops SET ${sets.join(', ')} WHERE id=$1 RETURNING *`, params);
        if (!rows[0]) throw new HttpError(404, 'SHOP_NOT_FOUND', 'Shop not found');
        // Capacity changes apply to future slots that stay at or above what is already reserved.
        if (b.slotCapacity !== undefined) {
          await tx.q.query(`UPDATE pickup_slots SET capacity=$2 WHERE shop_id=$1 AND starts_at > $3 AND reserved_count <= $2`, [req.params.shopId, b.slotCapacity, ctx.now()]);
        }
        await audit(tx.q, actor(req), 'SHOP_UPDATED', 'shop', req.params.shopId, b);
        return rows[0];
      });
      res.json({ shop: shopRow(shop) });
    }),
  );

  // ----- vendor users -----
  r.post(
    '/admin/vendors',
    asyncHandler(async (req, res) => {
      const b = z
        .object({ name: z.string().min(1).max(80), email: z.string().email(), password: z.string().min(8).max(100), shopId: uuid, memberRole: z.enum(['OWNER', 'MANAGER', 'STAFF']).default('OWNER') })
        .parse(req.body);
      const out = await withTx(ctx, async (tx) => {
        const shops = await tx.q.query(`SELECT id FROM shops WHERE id=$1`, [b.shopId]);
        if (!shops[0]) throw new HttpError(404, 'SHOP_NOT_FOUND', 'Shop not found');
        const dup = await tx.q.query(`SELECT id FROM users WHERE email=$1`, [b.email.toLowerCase()]);
        if (dup[0]) throw new HttpError(409, 'EMAIL_IN_USE', 'A user with this email already exists');
        const [u] = await tx.q.query(`INSERT INTO users (name, email, role, password_hash) VALUES ($1,$2,'VENDOR',$3) RETURNING id, name, email`, [
          b.name,
          b.email.toLowerCase(),
          await hashPassword(b.password),
        ]);
        await tx.q.query(`INSERT INTO shop_members (user_id, shop_id, role) VALUES ($1,$2,$3)`, [u.id, b.shopId, b.memberRole]);
        await audit(tx.q, actor(req), 'VENDOR_CREATED', 'user', u.id, { shopId: b.shopId });
        return u;
      });
      res.status(201).json({ vendor: out });
    }),
  );

  r.get(
    '/admin/vendors',
    asyncHandler(async (_req, res) => {
      const rows = await ctx.db.query(
        `SELECT u.id, u.name, u.email, u.status, sm.shop_id, sm.role AS member_role, s.name AS shop_name
           FROM users u JOIN shop_members sm ON sm.user_id=u.id JOIN shops s ON s.id=sm.shop_id WHERE u.role='VENDOR' ORDER BY s.name, u.name`,
      );
      res.json({ vendors: rows.map((v: any) => ({ id: v.id, name: v.name, email: v.email, status: v.status, shopId: v.shop_id, shopName: v.shop_name, memberRole: v.member_role })) });
    }),
  );

  // ----- menu -----
  r.get(
    '/admin/shops/:shopId/menu',
    asyncHandler(async (req, res) => {
      if (!uuid.safeParse(req.params.shopId).success) throw new HttpError(404, 'SHOP_NOT_FOUND', 'Shop not found');
      const categories = await ctx.db.query(`SELECT id, name, sort_order, active FROM categories WHERE shop_id=$1 ORDER BY sort_order, name`, [req.params.shopId]);
      const items = await ctx.db.query(`SELECT * FROM menu_items WHERE shop_id=$1 ORDER BY name`, [req.params.shopId]);
      res.json({
        categories,
        items: items.map((i: any) => ({ id: i.id, categoryId: i.category_id, name: i.name, description: i.description, basePricePaise: Number(i.base_price_paise), available: i.available })),
      });
    }),
  );

  r.post(
    '/admin/shops/:shopId/categories',
    asyncHandler(async (req, res) => {
      const b = z.object({ name: z.string().min(1).max(60), sortOrder: z.number().int().default(0) }).parse(req.body);
      if (!uuid.safeParse(req.params.shopId).success) throw new HttpError(404, 'SHOP_NOT_FOUND', 'Shop not found');
      const rows = await withTx(ctx, async (tx) => {
        const r2 = await tx.q.query(`INSERT INTO categories (shop_id, name, sort_order) VALUES ($1,$2,$3) RETURNING id, name`, [req.params.shopId, b.name, b.sortOrder]);
        await audit(tx.q, actor(req), 'CATEGORY_CREATED', 'category', r2[0].id, { shopId: req.params.shopId });
        return r2;
      });
      res.status(201).json({ category: rows[0] });
    }),
  );

  r.post(
    '/admin/shops/:shopId/menu-items',
    asyncHandler(async (req, res) => {
      const b = z
        .object({ name: z.string().min(1).max(100), description: z.string().max(300).default(''), basePricePaise: z.number().int().min(0).max(10_000_000), categoryId: uuid.nullable().default(null) })
        .parse(req.body);
      if (!uuid.safeParse(req.params.shopId).success) throw new HttpError(404, 'SHOP_NOT_FOUND', 'Shop not found');
      const item = await withTx(ctx, async (tx) => {
        const rows = await tx.q.query(
          `INSERT INTO menu_items (shop_id, category_id, name, description, base_price_paise) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, base_price_paise`,
          [req.params.shopId, b.categoryId, b.name, b.description, b.basePricePaise],
        );
        await audit(tx.q, actor(req), 'MENU_ITEM_CREATED', 'menu_item', rows[0].id, { shopId: req.params.shopId, basePricePaise: b.basePricePaise });
        return rows[0];
      });
      res.status(201).json({ item: { id: item.id, name: item.name, basePricePaise: Number(item.base_price_paise) } });
    }),
  );

  // Price edits never touch existing orders: orders carry their own item/price snapshot.
  r.patch(
    '/admin/menu-items/:itemId',
    asyncHandler(async (req, res) => {
      const b = z.object({ name: z.string().min(1).max(100), description: z.string().max(300), basePricePaise: z.number().int().min(0).max(10_000_000), available: z.boolean() }).partial().strict().parse(req.body);
      if (!uuid.safeParse(req.params.itemId).success) throw new HttpError(404, 'ITEM_NOT_FOUND', 'Item not found');
      const cols: Record<string, string> = { name: 'name', description: 'description', basePricePaise: 'base_price_paise', available: 'available' };
      const sets: string[] = [];
      const params: unknown[] = [req.params.itemId];
      for (const [k, v] of Object.entries(b)) {
        params.push(v);
        sets.push(`${cols[k]}=$${params.length}`);
      }
      if (!sets.length) throw new HttpError(400, 'NO_CHANGES', 'Nothing to update');
      const item = await withTx(ctx, async (tx) => {
        const rows = await tx.q.query(`UPDATE menu_items SET ${sets.join(', ')} WHERE id=$1 RETURNING id, name, base_price_paise, available`, params);
        if (!rows[0]) throw new HttpError(404, 'ITEM_NOT_FOUND', 'Item not found');
        await audit(tx.q, actor(req), 'MENU_ITEM_UPDATED', 'menu_item', req.params.itemId, b);
        return rows[0];
      });
      res.json({ item: { id: item.id, name: item.name, basePricePaise: Number(item.base_price_paise), available: item.available } });
    }),
  );

  // ----- devices (tablets stay QuickPick property) -----
  r.get(
    '/admin/devices',
    asyncHandler(async (_req, res) => {
      const rows = await ctx.db.query(`SELECT d.*, s.name AS shop_name FROM devices d LEFT JOIN shops s ON s.id=d.shop_id ORDER BY d.asset_tag`);
      const now = ctx.now().getTime();
      res.json({
        devices: rows.map((d: any) => ({
          id: d.id, assetTag: d.asset_tag, model: d.model, status: d.status, shopId: d.shop_id, shopName: d.shop_name, conditionNotes: d.condition_notes,
          lastSeenAt: d.last_seen_at, assignedAt: d.assigned_at, returnedAt: d.returned_at,
          online: d.last_seen_at ? now - new Date(d.last_seen_at).getTime() < 90_000 : false,
        })),
      });
    }),
  );

  r.post(
    '/admin/devices',
    asyncHandler(async (req, res) => {
      const b = z.object({ assetTag: z.string().min(1).max(40), model: z.string().max(100).default(''), conditionNotes: z.string().max(300).default('') }).parse(req.body);
      const dup = await ctx.db.query(`SELECT 1 FROM devices WHERE asset_tag=$1`, [b.assetTag]);
      if (dup[0]) throw new HttpError(409, 'ASSET_TAG_IN_USE', 'Asset tag already registered');
      const device = await withTx(ctx, async (tx) => {
        const rows = await tx.q.query(`INSERT INTO devices (asset_tag, model, condition_notes) VALUES ($1,$2,$3) RETURNING *`, [b.assetTag, b.model, b.conditionNotes]);
        await audit(tx.q, actor(req), 'DEVICE_REGISTERED', 'device', rows[0].id, { assetTag: b.assetTag });
        return rows[0];
      });
      res.status(201).json({ device: { id: device.id, assetTag: device.asset_tag } });
    }),
  );

  // A device belongs to at most one shop at a time. shopId=null records a return.
  r.post(
    '/admin/devices/assign',
    asyncHandler(async (req, res) => {
      const b = z.object({ deviceId: uuid, shopId: uuid.nullable(), conditionNotes: z.string().max(300).optional() }).parse(req.body);
      const device = await withTx(ctx, async (tx) => {
        const rows = await tx.q.query(`SELECT * FROM devices WHERE id=$1 FOR UPDATE`, [b.deviceId]);
        if (!rows[0]) throw new HttpError(404, 'DEVICE_NOT_FOUND', 'Device not found');
        if (b.shopId) {
          const shop = await tx.q.query(`SELECT 1 FROM shops WHERE id=$1`, [b.shopId]);
          if (!shop[0]) throw new HttpError(404, 'SHOP_NOT_FOUND', 'Shop not found');
        }
        const updated = b.shopId
          ? await tx.q.query(`UPDATE devices SET shop_id=$2, status='LOANED', assigned_at=$3, returned_at=NULL, condition_notes=COALESCE($4, condition_notes) WHERE id=$1 RETURNING *`, [b.deviceId, b.shopId, ctx.now(), b.conditionNotes ?? null])
          : await tx.q.query(`UPDATE devices SET shop_id=NULL, status='RETURNED', returned_at=$2, condition_notes=COALESCE($3, condition_notes) WHERE id=$1 RETURNING *`, [b.deviceId, ctx.now(), b.conditionNotes ?? null]);
        await audit(tx.q, actor(req), b.shopId ? 'DEVICE_ASSIGNED' : 'DEVICE_RETURNED', 'device', b.deviceId, { shopId: b.shopId });
        return updated[0];
      });
      res.json({ device: { id: device.id, assetTag: device.asset_tag, shopId: device.shop_id, status: device.status } });
    }),
  );

  // ----- orders, payments, refunds -----
  r.get(
    '/admin/orders',
    asyncHandler(async (req, res) => {
      const q = z.object({ status: z.string().optional(), shopId: uuid.optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
      const where: string[] = ['TRUE'];
      const params: unknown[] = [];
      if (q.status) { params.push(q.status); where.push(`o.status=$${params.length}`); }
      if (q.shopId) { params.push(q.shopId); where.push(`o.shop_id=$${params.length}`); }
      if (q.date) { const d = istDayRange(q.date); params.push(d.start, d.end); where.push(`o.created_at >= $${params.length - 1} AND o.created_at < $${params.length}`); }
      res.json({ orders: await selectOrders(ctx.db, where.join(' AND '), params, { limit: 200 }) });
    }),
  );

  r.get(
    '/admin/orders/:orderId',
    asyncHandler(async (req, res) => {
      if (!uuid.safeParse(req.params.orderId).success) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
      const [order] = await selectOrders(ctx.db, 'o.id=$1', [req.params.orderId]);
      if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
      const events = await ctx.db.query(`SELECT from_status, to_status, actor_type, reason, created_at FROM order_events WHERE order_id=$1 ORDER BY id`, [order.id]);
      const payments = await ctx.db.query(`SELECT id, provider, provider_ref, amount_paise, status, created_at FROM payments WHERE order_id=$1`, [order.id]);
      const refunds = await ctx.db.query(`SELECT id, amount_paise, reason, status, provider_ref, created_at, processed_at FROM refunds WHERE order_id=$1 ORDER BY created_at`, [order.id]);
      const splits = await ctx.db.query(`SELECT beneficiary_type, amount_paise, status FROM payment_splits WHERE order_id=$1`, [order.id]);
      res.json({
        order,
        events: events.map((e: any) => ({ from: e.from_status, to: e.to_status, actor: e.actor_type, reason: e.reason, at: e.created_at })),
        payments: payments.map((p: any) => ({ id: p.id, provider: p.provider, providerRef: p.provider_ref, amountPaise: Number(p.amount_paise), status: p.status })),
        refunds: refunds.map((f: any) => ({ id: f.id, amountPaise: Number(f.amount_paise), reason: f.reason, status: f.status, providerRef: f.provider_ref, at: f.created_at })),
        splits: splits.map((s: any) => ({ beneficiary: s.beneficiary_type, amountPaise: Number(s.amount_paise), status: s.status })),
      });
    }),
  );

  r.get(
    '/admin/payments',
    asyncHandler(async (_req, res) => {
      const rows = await ctx.db.query(
        `SELECT p.id, p.provider, p.provider_ref, p.amount_paise, p.status, p.created_at, o.order_number, o.id AS order_id,
                COALESCE((SELECT SUM(amount_paise) FROM refunds f WHERE f.payment_id=p.id AND f.status='PROCESSED'),0)::bigint AS refunded_paise
           FROM payments p JOIN orders o ON o.id=p.order_id ORDER BY p.created_at DESC LIMIT 200`,
      );
      res.json({ payments: rows.map((p: any) => ({ id: p.id, orderId: p.order_id, orderNumber: p.order_number, provider: p.provider, providerRef: p.provider_ref, amountPaise: Number(p.amount_paise), refundedPaise: Number(p.refunded_paise), status: p.status, createdAt: p.created_at })) });
    }),
  );

  r.post(
    '/admin/refunds',
    asyncHandler(async (req, res) => {
      const b = z.object({ orderId: uuid, amountPaise: z.number().int().positive().optional(), reason: z.string().min(1).max(200) }).parse(req.body);
      const key = (req.headers['idempotency-key'] as string | undefined) ?? `admin:${b.orderId}:${b.amountPaise ?? 'full'}:${Date.now()}`;
      const refund = await withTx(ctx, (tx) => initiateRefund(ctx, tx, { orderId: b.orderId, amountPaise: b.amountPaise, reason: b.reason, idempotencyKey: key, actor: { type: 'ADMIN', id: req.auth!.id, role: req.auth!.role } }));
      res.status(201).json({ refund: { id: refund.id, amountPaise: Number(refund.amount_paise), status: refund.status } });
    }),
  );

  // Simple ledger check: paid orders must have matching planned splits (vendor + platform + tax = total).
  r.get(
    '/admin/reconciliation',
    asyncHandler(async (_req, res) => {
      const rows = await ctx.db.query(
        `SELECT o.order_number, p.amount_paise AS paid_paise,
                COALESCE((SELECT SUM(amount_paise) FROM payment_splits s WHERE s.order_id=o.id),0)::bigint AS split_paise,
                COALESCE((SELECT SUM(amount_paise) FROM refunds f WHERE f.order_id=o.id AND f.status='PROCESSED'),0)::bigint AS refunded_paise,
                o.payment_status
           FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.status IN ('SUCCEEDED','REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED') ORDER BY o.created_at DESC LIMIT 200`,
      );
      res.json({
        rows: rows.map((r2: any) => {
          const paid = Number(r2.paid_paise), split = Number(r2.split_paise), refunded = Number(r2.refunded_paise);
          // Splits are legitimately absent for late-success auto-refunds; flag the rest.
          const ok = split === paid || (split === 0 && refunded === paid);
          return { orderNumber: r2.order_number, paidPaise: paid, plannedSplitPaise: split, refundedPaise: refunded, paymentStatus: r2.payment_status, matches: ok, differencePaise: paid - split };
        }),
      });
    }),
  );

  // ----- pricing policy (SUPER_ADMIN only for changes) -----
  r.get(
    '/admin/pricing-policies',
    asyncHandler(async (_req, res) => {
      res.json({ policies: (await ctx.db.query(`SELECT * FROM pricing_policies ORDER BY version DESC`)).map(policyRowToView) });
    }),
  );

  r.patch(
    '/admin/pricing-policy',
    asyncHandler(async (req, res, next) => {
      if (req.auth!.role !== 'SUPER_ADMIN') return next(new HttpError(403, 'FORBIDDEN', 'Only the platform owner can change pricing'));
      const b = z
        .object({
          feeRateBps: z.number().int().min(0).max(5000),
          taxMode: z.enum(['NONE', 'INCLUSIVE', 'EXCLUSIVE']).default('NONE'),
          taxRateBps: z.number().int().min(0).max(10000).default(0),
          approved: z.boolean().default(false),
          note: z.string().max(300).default(''),
        })
        .parse(req.body);
      if (b.taxMode !== 'NONE' && b.taxRateBps === 0) throw new HttpError(400, 'TAX_RATE_REQUIRED', 'Set a tax rate for this tax mode');
      const policy = await withTx(ctx, async (tx) => {
        const [{ v }] = await tx.q.query<{ v: number }>(`SELECT COALESCE(MAX(version),0)+1 AS v FROM pricing_policies`);
        const rows = await tx.q.query(
          `INSERT INTO pricing_policies (version, fee_rate_bps, tax_mode, tax_rate_bps, approved, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [v, b.feeRateBps, b.taxMode, b.taxRateBps, b.approved, b.note, req.auth!.id],
        );
        await audit(tx.q, actor(req), 'PRICING_POLICY_CREATED', 'pricing_policy', rows[0].id, b);
        return rows[0];
      });
      res.status(201).json({ policy: policyRowToView(policy) });
    }),
  );

  // ----- analytics + export + support -----
  r.get(
    '/admin/analytics',
    asyncHandler(async (req, res) => {
      const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(istDate(ctx.now())).parse(req.query.date);
      const { start, end } = istDayRange(date);
      const [row] = await ctx.db.query(
        `SELECT COUNT(*)::bigint AS orders,
                COUNT(*) FILTER (WHERE status IN ('AWAITING_VENDOR','ACCEPTED','PREPARING','READY','COLLECTED','NOT_COLLECTED'))::bigint AS paid_orders,
                COALESCE(SUM(subtotal_paise) FILTER (WHERE status IN ('AWAITING_VENDOR','ACCEPTED','PREPARING','READY','COLLECTED','NOT_COLLECTED')),0)::bigint AS gmv_paise,
                COALESCE(SUM(fee_paise) FILTER (WHERE status IN ('AWAITING_VENDOR','ACCEPTED','PREPARING','READY','COLLECTED','NOT_COLLECTED')),0)::bigint AS fee_paise,
                COUNT(*) FILTER (WHERE status IN ('CANCELLED','REJECTED','EXPIRED'))::bigint AS cancelled,
                COUNT(*) FILTER (WHERE payment_status IN ('REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED'))::bigint AS refunded
           FROM orders WHERE created_at >= $1 AND created_at < $2`,
        [start, end],
      );
      const [{ active }] = await ctx.db.query<{ active: number }>(`SELECT COUNT(*)::bigint AS active FROM shops WHERE status='ACTIVE'`);
      res.json({
        date,
        orders: Number(row.orders), paidOrders: Number(row.paid_orders), foodGmvPaise: Number(row.gmv_paise), grossFeePaise: Number(row.fee_paise),
        cancelledOrders: Number(row.cancelled), refundedOrders: Number(row.refunded), activeShops: Number(active),
        note: 'Gross fee is not profit. Sandbox data only.',
      });
    }),
  );

  r.get(
    '/admin/export/orders.csv',
    asyncHandler(async (req, res) => {
      const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(istDate(ctx.now())).parse(req.query.date);
      const { start, end } = istDayRange(date);
      const orders = await selectOrders(ctx.db, 'o.created_at >= $1 AND o.created_at < $2', [start, end], { limit: 500, orderBy: 'o.created_at ASC' });
      const header = ['order_number', 'shop', 'status', 'payment_status', 'subtotal_paise', 'fee_rate_bps', 'fee_paise', 'tax_paise', 'total_paise', 'pickup_start', 'created_at'];
      const lines = [header.join(',')].concat(
        orders.map((o) => [o.orderNumber, o.shopName, o.status, o.paymentStatus, o.subtotalPaise, o.feeRateBps, o.feePaise, o.taxPaise, o.totalPaise, o.slotStartsAt, o.createdAt].map(csvCell).join(',')),
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="quickpick-orders-${date}.csv"`);
      res.send(lines.join('\n') + '\n');
    }),
  );

  r.get(
    '/admin/complaints',
    asyncHandler(async (_req, res) => {
      const rows = await ctx.db.query(`SELECT c.*, o.order_number FROM complaints c JOIN orders o ON o.id=c.order_id ORDER BY c.created_at DESC LIMIT 200`);
      res.json({ complaints: rows.map((c: any) => ({ id: c.id, orderNumber: c.order_number, category: c.category, description: c.description, status: c.status, resolution: c.resolution, createdAt: c.created_at })) });
    }),
  );

  r.patch(
    '/admin/complaints/:id',
    asyncHandler(async (req, res) => {
      const b = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']), resolution: z.string().max(500).optional() }).parse(req.body);
      if (!uuid.safeParse(req.params.id).success) throw new HttpError(404, 'NOT_FOUND', 'Complaint not found');
      const rows = await withTx(ctx, async (tx) => {
        const u = await tx.q.query(`UPDATE complaints SET status=$2, resolution=COALESCE($3, resolution), updated_at=now() WHERE id=$1 RETURNING id, status`, [req.params.id, b.status, b.resolution ?? null]);
        if (!u[0]) throw new HttpError(404, 'NOT_FOUND', 'Complaint not found');
        await audit(tx.q, actor(req), 'COMPLAINT_UPDATED', 'complaint', req.params.id, b);
        return u;
      });
      res.json({ complaint: rows[0] });
    }),
  );

  r.get(
    '/admin/audit-logs',
    asyncHandler(async (_req, res) => {
      const rows = await ctx.db.query(`SELECT id, actor_role, action, entity_type, entity_id, metadata, created_at FROM audit_logs ORDER BY id DESC LIMIT 200`);
      res.json({ logs: rows });
    }),
  );

  return r;
}
