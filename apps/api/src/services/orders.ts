import crypto from 'node:crypto';
import { RELEASING_STATUSES, canTransition, computeBreakdown, type OrderStatus, type OrderView } from '@quickpick/shared';
import { HttpError, withTx, type AppContext, type Tx } from '../context.js';
import type { Queryable } from '../db.js';
import { initiateRefund, type Actor } from './ledger.js';
import { getActivePolicy } from './pricing.js';
import { releaseSlot, reserveSlot, slotMatchesShop } from './slots.js';

export interface QuoteInput {
  shopId: string;
  slotId: string;
  items: Array<{ menuItemId: string; quantity: number }>;
}

const ORDER_NUMBER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomCode = (n: number) => Array.from({ length: n }, () => ORDER_NUMBER_ALPHABET[crypto.randomInt(ORDER_NUMBER_ALPHABET.length)]).join('');

/** Server-side quote. Client-supplied prices are never accepted — only item ids and quantities. */
export async function buildQuote(ctx: AppContext, q: Queryable, input: QuoteInput) {
  const shopRows = await q.query(`SELECT * FROM shops WHERE id=$1`, [input.shopId]);
  const shop = shopRows[0];
  if (!shop || shop.status !== 'ACTIVE') throw new HttpError(404, 'SHOP_NOT_FOUND', 'Shop not found');
  if (!shop.accepting_orders) throw new HttpError(409, 'SHOP_PAUSED', 'This shop is not taking QuickPick orders right now');

  const merged = new Map<string, number>();
  for (const it of input.items) merged.set(it.menuItemId, (merged.get(it.menuItemId) ?? 0) + it.quantity);
  const ids = [...merged.keys()];
  const menu = await q.query(`SELECT * FROM menu_items WHERE id = ANY($1::uuid[])`, [ids]);
  if (menu.some((m: any) => m.shop_id !== input.shopId)) {
    throw new HttpError(400, 'MULTI_SHOP_CART', 'An order can contain items from one shop only');
  }
  if (menu.length !== ids.length) throw new HttpError(404, 'ITEM_NOT_FOUND', 'One or more items no longer exist');
  const lines = menu.map((m: any) => {
    const quantity = merged.get(m.id)!;
    if (quantity > 20) throw new HttpError(400, 'QUANTITY_TOO_HIGH', 'Maximum 20 of one item per order');
    if (!m.available) throw new HttpError(409, 'ITEM_UNAVAILABLE', `${m.name} is currently unavailable`);
    const unit = Number(m.base_price_paise);
    return { menuItemId: m.id as string, name: m.name as string, unitPricePaise: unit, quantity, lineTotalPaise: unit * quantity };
  });
  const subtotal = lines.reduce((s, l) => s + l.lineTotalPaise, 0);
  const policy = await getActivePolicy(ctx, q);
  const breakdown = computeBreakdown(subtotal, policy);

  const slots = await q.query(`SELECT * FROM pickup_slots WHERE id=$1 AND shop_id=$2`, [input.slotId, input.shopId]);
  const slot = slots[0];
  if (!slot) throw new HttpError(404, 'SLOT_NOT_FOUND', 'Pickup slot not found for this shop');
  if (!slotMatchesShop(shop, slot)) throw new HttpError(409, 'SLOT_UNAVAILABLE', 'That pickup time is no longer offered. Please choose another time.');
  if (new Date(slot.starts_at).getTime() < ctx.now().getTime() + ctx.config.minLeadMinutes * 60_000) {
    throw new HttpError(409, 'SLOT_UNAVAILABLE', 'That pickup time has passed or is too soon');
  }
  if (slot.reserved_count >= slot.capacity) throw new HttpError(409, 'SLOT_FULL', 'That pickup slot is full. Please choose another time.');

  return { shop, lines, breakdown, policy, slot };
}

export async function createOrder(ctx: AppContext, user: { id: string }, input: QuoteInput, idempotencyKey: string) {
  const existing = await ctx.db.query(`SELECT id FROM orders WHERE user_id=$1 AND idempotency_key=$2`, [user.id, idempotencyKey]);
  if (existing[0]) return { orderId: existing[0].id as string, created: false };

  try {
    return await withTx(ctx, async (tx) => {
      const quote = await buildQuote(ctx, tx.q, input);
      await reserveSlot(ctx, tx.q, input.slotId, input.shopId);
      const now = ctx.now();
      const { breakdown, policy, shop } = quote;
      // Pick an unused human-readable number (UNIQUE constraint remains the backstop).
      let orderNumber = '';
      for (let attempt = 0; attempt < 8 && !orderNumber; attempt++) {
        const candidate = 'JQ-' + randomCode(4);
        const taken = await tx.q.query(`SELECT 1 FROM orders WHERE order_number=$1`, [candidate]);
        if (taken.length === 0) orderNumber = candidate;
      }
      if (!orderNumber) throw new HttpError(500, 'ORDER_NUMBER_FAILED', 'Could not allocate an order number');
      const rows = await tx.q.query(
        `INSERT INTO orders (order_number, pickup_code, user_id, shop_id, slot_id, subtotal_paise, fee_rate_bps, fee_paise, tax_mode, tax_rate_bps,
           tax_paise, total_paise, pricing_policy_id, pricing_policy_version, idempotency_key, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [
          orderNumber,
          String(crypto.randomInt(1000, 10000)),
          user.id,
          shop.id,
          input.slotId,
          breakdown.subtotalPaise,
          breakdown.feeRateBps,
          breakdown.feePaise,
          breakdown.taxMode,
          breakdown.taxRateBps,
          breakdown.taxPaise,
          breakdown.totalPaise,
          policy.id,
          policy.version,
          idempotencyKey,
          new Date(now.getTime() + ctx.config.checkoutTtlSeconds * 1000),
        ],
      );
      const orderId: string = rows[0].id;
      for (const l of quote.lines) {
        await tx.q.query(
          `INSERT INTO order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity, line_total_paise) VALUES ($1,$2,$3,$4,$5,$6)`,
          [orderId, l.menuItemId, l.name, l.unitPricePaise, l.quantity, l.lineTotalPaise],
        );
      }
      await tx.q.query(`INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, reason) VALUES ($1,NULL,'PENDING_PAYMENT','STUDENT',$2,'Checkout started')`, [
        orderId,
        user.id,
      ]);
      return { orderId, created: true };
    });
  } catch (e: any) {
    if (e?.code === '23505' && String(e?.constraint ?? e?.detail ?? e?.message).includes('idempotency')) {
      const again = await ctx.db.query(`SELECT id FROM orders WHERE user_id=$1 AND idempotency_key=$2`, [user.id, idempotencyKey]);
      if (again[0]) return { orderId: again[0].id as string, created: false };
    }
    throw e;
  }
}

/**
 * The single place order status changes. Enforces the state machine, appends an order event, releases the pickup slot
 * exactly once and auto-refunds paid orders that end in REJECTED / CANCELLED / EXPIRED.
 */
export async function transitionOrder(
  ctx: AppContext,
  tx: Tx,
  orderId: string,
  to: OrderStatus,
  actor: Actor,
  opts: { reason?: string; scope?: { shopId?: string; userId?: string }; prepMinutes?: number; allowFrom?: OrderStatus[] } = {},
) {
  const rows = await tx.q.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`, [orderId]);
  const order = rows[0];
  // Out-of-scope rows look identical to missing rows so other tenants' order ids cannot be probed.
  if (!order || (opts.scope?.shopId && order.shop_id !== opts.scope.shopId) || (opts.scope?.userId && order.user_id !== opts.scope.userId)) {
    throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  const from = order.status as OrderStatus;
  if (opts.allowFrom && !opts.allowFrom.includes(from)) {
    throw new HttpError(409, 'INVALID_TRANSITION', `Cannot move an order from ${from} to ${to}`);
  }
  if (!canTransition(from, to)) throw new HttpError(409, 'INVALID_TRANSITION', `Cannot move an order from ${from} to ${to}`);

  await tx.q.query(
    `UPDATE orders SET status=$2, updated_at=now(), prep_minutes = COALESCE($3, prep_minutes) WHERE id=$1`,
    [orderId, to, opts.prepMinutes ?? null],
  );
  await tx.q.query(
    `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, reason) VALUES ($1,$2,$3,$4,$5,$6)`,
    [orderId, from, to, actor.type, actor.id ?? null, opts.reason ?? null],
  );

  const paid = order.payment_status === 'SUCCEEDED';
  if (RELEASING_STATUSES.includes(to)) {
    await releaseSlot(tx.q, orderId);
    if (paid) {
      await initiateRefund(ctx, tx, {
        orderId,
        reason: opts.reason ?? `Order ${to.toLowerCase()}`,
        idempotencyKey: `auto:${orderId}`,
        actor,
      });
    }
  }

  tx.post.push(() =>
    ctx.bus.emitOrder({
      orderId,
      shopId: order.shop_id,
      userId: order.user_id,
      status: to,
      paymentStatus: paid && RELEASING_STATUSES.includes(to) ? 'REFUND_PENDING' : order.payment_status,
      notifyVendor: paid || order.payment_status === 'REFUND_PENDING',
      kind: 'UPDATE',
    }),
  );
  return { orderId, from, to };
}

/** Expire unpaid checkouts and unanswered paid orders. Safe to run repeatedly and concurrently. */
export async function expireStaleOrders(ctx: AppContext): Promise<number> {
  const now = ctx.now();
  const stale = await ctx.db.query<{ id: string; status: string }>(
    `SELECT id, status FROM orders WHERE (status='PENDING_PAYMENT' AND expires_at < $1) OR (status='AWAITING_VENDOR' AND accept_deadline < $1)`,
    [now],
  );
  let count = 0;
  for (const s of stale) {
    try {
      await withTx(ctx, async (tx) => {
        // Re-check under lock: the order may have moved on since the scan.
        const [o] = await tx.q.query(
          `SELECT status, expires_at, accept_deadline FROM orders WHERE id=$1 FOR UPDATE`,
          [s.id],
        );
        const stillStale =
          (o?.status === 'PENDING_PAYMENT' && new Date(o.expires_at) < now) || (o?.status === 'AWAITING_VENDOR' && new Date(o.accept_deadline) < now);
        if (!stillStale) return;
        await transitionOrder(ctx, tx, s.id, 'EXPIRED', { type: 'SYSTEM' }, {
          reason: o.status === 'PENDING_PAYMENT' ? 'Checkout expired before payment' : 'Shop did not respond in time',
        });
        count++;
      });
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
    }
  }
  return count;
}

// ---------- read models ----------

const first = (name: string) => name.split(' ')[0];

export async function selectOrders(
  q: Queryable,
  where: string,
  params: unknown[],
  opts: { vendorView?: boolean; studentView?: boolean; limit?: number; orderBy?: string } = {},
): Promise<OrderView[]> {
  const rows = await q.query(
    `SELECT o.*, s.starts_at AS slot_starts_at, s.ends_at AS slot_ends_at, sh.name AS shop_name, u.name AS customer_name
       FROM orders o
       JOIN pickup_slots s ON s.id = o.slot_id
       JOIN shops sh ON sh.id = o.shop_id
       JOIN users u ON u.id = o.user_id
      WHERE ${where}
      ORDER BY ${opts.orderBy ?? 'o.created_at DESC'}
      LIMIT ${Math.min(opts.limit ?? 100, 500)}`,
    params,
  );
  if (rows.length === 0) return [];
  const items = await q.query(`SELECT * FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY name_snapshot`, [rows.map((r: any) => r.id)]);
  return rows.map((r: any) => ({
    id: r.id,
    orderNumber: r.order_number,
    // The pickup code is for the student only; the vendor enters it to confirm handover, so it is never sent to vendors.
    ...(opts.vendorView ? {} : { pickupCode: r.pickup_code }),
    shopId: r.shop_id,
    shopName: r.shop_name,
    status: r.status,
    paymentStatus: r.payment_status,
    subtotalPaise: Number(r.subtotal_paise),
    feeRateBps: r.fee_rate_bps,
    feePaise: Number(r.fee_paise),
    taxPaise: Number(r.tax_paise),
    totalPaise: Number(r.total_paise),
    slotStartsAt: new Date(r.slot_starts_at).toISOString(),
    slotEndsAt: new Date(r.slot_ends_at).toISOString(),
    prepMinutes: r.prep_minutes,
    acceptDeadline: r.accept_deadline ? new Date(r.accept_deadline).toISOString() : null,
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    // Vendors only see a first name — never student email/phone.
    ...(opts.vendorView ? { customerName: first(r.customer_name) } : {}),
    items: items
      .filter((i: any) => i.order_id === r.id)
      .map((i: any) => ({
        menuItemId: i.menu_item_id,
        name: i.name_snapshot,
        unitPricePaise: Number(i.unit_price_paise),
        quantity: i.quantity,
        lineTotalPaise: Number(i.line_total_paise),
      })),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}
