import { VENDOR_ACTIVE_STATUSES, type OrderStatus } from '@quickpick/shared';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, requireRole, vendorShopId } from '../auth.js';
import { HttpError, IST_OFFSET_MS, istDate, istDayRange, withTx, type AppContext } from '../context.js';
import { selectOrders, transitionOrder } from '../services/orders.js';

const uuid = z.string().uuid();

export function vendorRoutes(ctx: AppContext): Router {
  const r = Router();
  r.use('/vendor', requireRole(ctx, 'VENDOR'));

  // Every query below is scoped by vendorShopId(req) — the shop comes from the vendor's own memberships, never from input.

  r.get(
    '/vendor/shop',
    asyncHandler(async (req, res) => {
      const shopId = vendorShopId(req);
      const [s] = await ctx.db.query(`SELECT * FROM shops WHERE id=$1`, [shopId]);
      const items = await ctx.db.query(`SELECT id, name, base_price_paise, available FROM menu_items WHERE shop_id=$1 ORDER BY name`, [shopId]);
      res.json({
        shop: { id: s.id, name: s.name, status: s.status, acceptingOrders: s.accepting_orders, acceptTimeoutSeconds: s.accept_timeout_seconds },
        menu: items.map((i: any) => ({ id: i.id, name: i.name, basePricePaise: Number(i.base_price_paise), available: i.available })),
        shops: req.auth!.shopIds,
        serverTime: ctx.now().toISOString(),
      });
    }),
  );

  // Source of truth for the tablet: called on load, reconnect and on a polling fallback. Unpaid orders never appear.
  r.get(
    '/vendor/orders',
    asyncHandler(async (req, res) => {
      const shopId = vendorShopId(req);
      const active = VENDOR_ACTIVE_STATUSES.map((s) => `'${s}'`).join(',');
      const { start } = istDayRange(istDate(ctx.now()));
      const orders = await selectOrders(
        ctx.db,
        `o.shop_id=$1 AND (o.status IN (${active}) OR (o.status IN ('COLLECTED','REJECTED','CANCELLED','EXPIRED','NOT_COLLECTED') AND o.payment_status <> 'NOT_STARTED' AND o.updated_at >= $2))`,
        [shopId, start],
        { vendorView: true, orderBy: 's.starts_at ASC, o.created_at ASC', limit: 300 },
      );
      res.json({ orders, serverTime: ctx.now().toISOString() });
    }),
  );

  const act = (to: OrderStatus, allowFrom: OrderStatus[]) =>
    asyncHandler(async (req, res) => {
      const shopId = vendorShopId(req);
      const body = z
        .object({ reason: z.string().min(1).max(200).optional(), prepMinutes: z.number().int().min(1).max(120).optional(), pickupCode: z.string().optional() })
        .parse(req.body ?? {});
      if (to === 'REJECTED' && !body.reason) throw new HttpError(400, 'REASON_REQUIRED', 'A reason is required to reject an order');
      await withTx(ctx, async (tx) => {
        if (to === 'COLLECTED') {
          const [o] = await tx.q.query(`SELECT pickup_code, shop_id FROM orders WHERE id=$1 FOR UPDATE`, [req.params.orderId]);
          if (!o || o.shop_id !== shopId) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
          if (!body.pickupCode || body.pickupCode !== o.pickup_code) throw new HttpError(422, 'INVALID_PICKUP_CODE', 'Pickup code does not match');
        }
        await transitionOrder(ctx, tx, req.params.orderId, to, { type: 'VENDOR', id: req.auth!.id }, {
          reason: body.reason,
          prepMinutes: body.prepMinutes,
          scope: { shopId },
          allowFrom,
        });
      });
      const [order] = await selectOrders(ctx.db, 'o.id=$1', [req.params.orderId], { vendorView: true });
      res.json({ order });
    });

  const orderParam = (req: any, _res: any, next: any) => {
    if (!uuid.safeParse(req.params.orderId).success) return next(new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found'));
    next();
  };

  r.post('/vendor/orders/:orderId/accept', orderParam, act('ACCEPTED', ['AWAITING_VENDOR']));
  r.post('/vendor/orders/:orderId/reject', orderParam, act('REJECTED', ['AWAITING_VENDOR']));

  // Preparing / Ready / Collected / No-show / Cancel(unavailable after payment, refunded).
  r.patch(
    '/vendor/orders/:orderId/status',
    orderParam,
    asyncHandler(async (req, res, next) => {
      const { status } = z.object({ status: z.enum(['PREPARING', 'READY', 'COLLECTED', 'NOT_COLLECTED', 'CANCELLED']) }).parse(req.body);
      const allowFrom: Record<string, OrderStatus[]> = {
        PREPARING: ['ACCEPTED'],
        READY: ['PREPARING'],
        COLLECTED: ['READY'],
        NOT_COLLECTED: ['READY'],
        CANCELLED: ['ACCEPTED', 'PREPARING'],
      };
      if (status === 'CANCELLED' && !req.body.reason) throw new HttpError(400, 'REASON_REQUIRED', 'A reason is required');
      return act(status, allowFrom[status])(req, res, next);
    }),
  );

  r.patch(
    '/vendor/menu-items/:itemId',
    asyncHandler(async (req, res) => {
      const shopId = vendorShopId(req);
      const { available } = z.object({ available: z.boolean() }).parse(req.body);
      if (!uuid.safeParse(req.params.itemId).success) throw new HttpError(404, 'ITEM_NOT_FOUND', 'Item not found');
      const rows = await ctx.db.query(`UPDATE menu_items SET available=$3 WHERE id=$1 AND shop_id=$2 RETURNING id, available`, [req.params.itemId, shopId, available]);
      if (!rows[0]) throw new HttpError(404, 'ITEM_NOT_FOUND', 'Item not found');
      res.json({ item: rows[0] });
    }),
  );

  r.patch(
    '/vendor/shop/status',
    asyncHandler(async (req, res) => {
      const shopId = vendorShopId(req);
      const { acceptingOrders } = z.object({ acceptingOrders: z.boolean() }).parse(req.body);
      const rows = await ctx.db.query(`UPDATE shops SET accepting_orders=$2 WHERE id=$1 RETURNING id, accepting_orders`, [shopId, acceptingOrders]);
      res.json({ shopId: rows[0].id, acceptingOrders: rows[0].accepting_orders });
    }),
  );

  r.post(
    '/vendor/heartbeat',
    asyncHandler(async (req, res) => {
      const shopId = vendorShopId(req);
      await ctx.db.query(`UPDATE devices SET last_seen_at=$2 WHERE shop_id=$1`, [shopId, ctx.now()]);
      res.json({ ok: true, serverTime: ctx.now().toISOString() });
    }),
  );

  r.get(
    '/vendor/summary',
    asyncHandler(async (req, res) => {
      const shopId = vendorShopId(req);
      const { start, end } = istDayRange(istDate(ctx.now()));
      const [row] = await ctx.db.query(
        `SELECT COUNT(*) FILTER (WHERE status='COLLECTED')::bigint AS collected,
                COUNT(*) FILTER (WHERE status IN ('REJECTED','CANCELLED','EXPIRED') AND payment_status <> 'NOT_STARTED')::bigint AS not_fulfilled,
                COALESCE(SUM(subtotal_paise) FILTER (WHERE status='COLLECTED'),0)::bigint AS food_paise
           FROM orders WHERE shop_id=$1 AND created_at >= $2 AND created_at < $3`,
        [shopId, start, end],
      );
      res.json({ date: istDate(ctx.now()), collectedOrders: Number(row.collected), notFulfilled: Number(row.not_fulfilled), foodValuePaise: Number(row.food_paise), tzOffsetMs: IST_OFFSET_MS });
    }),
  );

  // Vendor settlement statement: planned vendor entitlement per day (original menu price). Illustrative until settlement is live.
  r.get(
    '/vendor/settlements',
    asyncHandler(async (req, res) => {
      const shopId = vendorShopId(req);
      const rows = await ctx.db.query(
        `SELECT to_char(o.created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS day,
                COUNT(*)::bigint AS orders,
                COALESCE(SUM(ps.amount_paise) FILTER (WHERE ps.status <> 'REVERSED'),0)::bigint AS entitlement_paise
           FROM payment_splits ps JOIN orders o ON o.id=ps.order_id
          WHERE ps.beneficiary_type='VENDOR' AND ps.shop_id=$1
          GROUP BY 1 ORDER BY 1 DESC LIMIT 31`,
        [shopId],
      );
      res.json({ note: 'Planned entitlement from sandbox orders. No real settlement has occurred.', days: rows.map((d: any) => ({ day: d.day, orders: Number(d.orders), entitlementPaise: Number(d.entitlement_paise) })) });
    }),
  );

  return r;
}
