import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, requireRole } from '../auth.js';
import { HttpError, withTx, type AppContext } from '../context.js';
import { createCheckout } from '../services/payments.js';
import { buildQuote, createOrder, selectOrders, transitionOrder } from '../services/orders.js';
import { getActivePolicy } from '../services/pricing.js';
import { isOpenNow, listAvailableSlots } from '../services/slots.js';

const uuid = z.string().uuid();
const quoteSchema = z.object({
  shopId: uuid,
  slotId: uuid,
  items: z.array(z.object({ menuItemId: uuid, quantity: z.number().int().min(1).max(20) })).min(1).max(30),
});

const shopView = (ctx: AppContext, s: any) => ({
  id: s.id,
  name: s.name,
  description: s.description,
  acceptingOrders: s.accepting_orders,
  openNow: isOpenNow(s, ctx.now()),
  openTime: s.open_time,
  closeTime: s.close_time,
  isDemo: s.is_demo,
});

export function studentRoutes(ctx: AppContext): Router {
  const r = Router();
  const student = requireRole(ctx, 'STUDENT');

  r.get('/config', (_req, res) => {
    res.json({ sandbox: true, paymentProvider: ctx.provider.name, currency: 'INR', note: 'Sandbox mode: no real money is taken.' });
  });

  // ----- public browsing: only ACTIVE shops are ever returned -----
  r.get(
    '/shops',
    asyncHandler(async (_req, res) => {
      const rows = await ctx.db.query(`SELECT * FROM shops WHERE status='ACTIVE' ORDER BY name`);
      res.json({ shops: rows.map((s) => shopView(ctx, s)) });
    }),
  );

  const activeShop = async (id: string) => {
    if (!uuid.safeParse(id).success) throw new HttpError(404, 'SHOP_NOT_FOUND', 'Shop not found');
    const rows = await ctx.db.query(`SELECT * FROM shops WHERE id=$1 AND status='ACTIVE'`, [id]);
    if (!rows[0]) throw new HttpError(404, 'SHOP_NOT_FOUND', 'Shop not found');
    return rows[0];
  };

  r.get(
    '/shops/:shopId',
    asyncHandler(async (req, res) => {
      res.json({ shop: shopView(ctx, await activeShop(req.params.shopId)) });
    }),
  );

  r.get(
    '/shops/:shopId/menu',
    asyncHandler(async (req, res) => {
      const shop = await activeShop(req.params.shopId);
      const categories = await ctx.db.query(`SELECT id, name FROM categories WHERE shop_id=$1 AND active=true ORDER BY sort_order, name`, [shop.id]);
      const items = await ctx.db.query(`SELECT * FROM menu_items WHERE shop_id=$1 ORDER BY name`, [shop.id]);
      res.json({
        shop: shopView(ctx, shop),
        categories,
        items: items.map((i: any) => ({
          id: i.id,
          categoryId: i.category_id,
          name: i.name,
          description: i.description,
          imageUrl: i.image_url,
          basePricePaise: Number(i.base_price_paise),
          available: i.available,
        })),
      });
    }),
  );

  r.get(
    '/shops/:shopId/pickup-slots',
    asyncHandler(async (req, res) => {
      const shop = await activeShop(req.params.shopId);
      const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().parse(req.query.date);
      res.json({ slots: await listAvailableSlots(ctx, ctx.db, shop, date) });
    }),
  );

  r.get(
    '/pricing-policy/current',
    asyncHandler(async (_req, res) => {
      const p = await getActivePolicy(ctx, ctx.db);
      res.json({ feeRateBps: p.feeRateBps, taxMode: p.taxMode, taxRateBps: p.taxRateBps, version: p.version, approved: p.approved });
    }),
  );

  // ----- ordering (students only) -----
  r.post(
    '/orders/quote',
    student,
    asyncHandler(async (req, res) => {
      const input = quoteSchema.parse(req.body);
      const q = await buildQuote(ctx, ctx.db, input);
      res.json({
        shopId: q.shop.id,
        shopName: q.shop.name,
        slot: { id: q.slot.id, startsAt: q.slot.starts_at, endsAt: q.slot.ends_at },
        items: q.lines,
        breakdown: q.breakdown,
        policyApproved: q.policy.approved,
        sandbox: true,
      });
    }),
  );

  r.post(
    '/orders',
    student,
    asyncHandler(async (req, res) => {
      const key = z.string().min(8).max(100).parse(req.headers['idempotency-key']);
      const input = quoteSchema.parse(req.body);
      const { orderId, created } = await createOrder(ctx, req.auth!, input, key);
      const [order] = await selectOrders(ctx.db, 'o.id=$1', [orderId]);
      res.status(created ? 201 : 200).json({ order });
    }),
  );

  r.post(
    '/payments/checkout',
    student,
    asyncHandler(async (req, res) => {
      const { orderId } = z.object({ orderId: uuid }).parse(req.body);
      res.json(await createCheckout(ctx, req.auth!.id, orderId));
    }),
  );

  r.get(
    '/me/orders',
    student,
    asyncHandler(async (req, res) => {
      res.json({ orders: await selectOrders(ctx.db, 'o.user_id=$1', [req.auth!.id], { limit: 50 }) });
    }),
  );

  // Another student's order id is indistinguishable from a missing one (404, not 403).
  r.get(
    '/orders/:orderId',
    student,
    asyncHandler(async (req, res) => {
      if (!uuid.safeParse(req.params.orderId).success) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
      const [order] = await selectOrders(ctx.db, 'o.id=$1 AND o.user_id=$2', [req.params.orderId, req.auth!.id]);
      if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
      const events = await ctx.db.query(`SELECT to_status, reason, created_at FROM order_events WHERE order_id=$1 ORDER BY id`, [order.id]);
      const refunds = await ctx.db.query(`SELECT amount_paise, status, created_at FROM refunds WHERE order_id=$1 ORDER BY created_at`, [order.id]);
      res.json({
        order,
        events: events.map((e: any) => ({ status: e.to_status, reason: e.reason, at: e.created_at })),
        refunds: refunds.map((f: any) => ({ amountPaise: Number(f.amount_paise), status: f.status, at: f.created_at })),
      });
    }),
  );

  // Cancellation is allowed only before the shop accepts. A paid cancellation is refunded in full automatically.
  r.post(
    '/orders/:orderId/cancel',
    student,
    asyncHandler(async (req, res) => {
      if (!uuid.safeParse(req.params.orderId).success) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
      await withTx(ctx, (tx) =>
        transitionOrder(ctx, tx, req.params.orderId, 'CANCELLED', { type: 'STUDENT', id: req.auth!.id }, {
          reason: 'Cancelled by student',
          scope: { userId: req.auth!.id },
          allowFrom: ['PENDING_PAYMENT', 'AWAITING_VENDOR'],
        }),
      );
      const [order] = await selectOrders(ctx.db, 'o.id=$1', [req.params.orderId]);
      res.json({ order });
    }),
  );

  r.post(
    '/orders/:orderId/support',
    student,
    asyncHandler(async (req, res) => {
      const body = z.object({ category: z.string().min(1).max(60), description: z.string().min(1).max(1000) }).parse(req.body);
      if (!uuid.safeParse(req.params.orderId).success) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
      const own = await ctx.db.query(`SELECT id FROM orders WHERE id=$1 AND user_id=$2`, [req.params.orderId, req.auth!.id]);
      if (!own[0]) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
      const rows = await ctx.db.query(`INSERT INTO complaints (order_id, user_id, category, description) VALUES ($1,$2,$3,$4) RETURNING id`, [
        req.params.orderId,
        req.auth!.id,
        body.category,
        body.description,
      ]);
      res.status(201).json({ complaintId: rows[0].id });
    }),
  );

  // ----- SANDBOX: simulate the payment provider calling our webhook (signed). Own orders only. -----
  r.post(
    '/sandbox/payments/simulate',
    student,
    asyncHandler(async (req, res) => {
      if (!ctx.sandboxDeliver) throw new HttpError(404, 'NOT_FOUND', 'Not available');
      const body = z.object({ orderId: uuid, outcome: z.enum(['success', 'failure']) }).parse(req.body);
      const rows = await ctx.db.query(
        `SELECT p.provider_ref, p.amount_paise FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.id=$1 AND o.user_id=$2`,
        [body.orderId, req.auth!.id],
      );
      if (!rows[0]) throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'Start checkout first');
      await ctx.sandboxDeliver({
        type: body.outcome === 'success' ? 'payment.succeeded' : 'payment.failed',
        providerRef: rows[0].provider_ref,
        amountPaise: Number(rows[0].amount_paise),
      });
      const [order] = await selectOrders(ctx.db, 'o.id=$1', [body.orderId]);
      res.json({ order });
    }),
  );

  return r;
}
