import crypto from 'node:crypto';
import { HttpError, withTx, type AppContext, type Tx } from '../context.js';
import { WebhookSignatureError, type VerifiedWebhookEvent } from '../payments/provider.js';
import { applyRefundProcessed, initiateRefund, planSplits } from './ledger.js';
import { transitionOrder } from './orders.js';
import { releaseSlot } from './slots.js';

/** Create (or return the existing) provider checkout for an order. One payment row per order; retries are idempotent. */
export async function createCheckout(ctx: AppContext, userId: string, orderId: string) {
  return withTx(ctx, async (tx) => {
    const rows = await tx.q.query(`SELECT * FROM orders WHERE id=$1 AND user_id=$2 FOR UPDATE`, [orderId, userId]);
    const order = rows[0];
    if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    if (order.status !== 'PENDING_PAYMENT') throw new HttpError(409, 'ORDER_NOT_PAYABLE', 'This order is no longer awaiting payment');
    if (new Date(order.expires_at) < ctx.now()) throw new HttpError(409, 'CHECKOUT_EXPIRED', 'This checkout has expired. Please start again.');

    const existing = await tx.q.query(`SELECT * FROM payments WHERE order_id=$1`, [orderId]);
    if (existing[0]) return { providerRef: existing[0].provider_ref as string, amountPaise: Number(existing[0].amount_paise), sandbox: true as const };

    const key = `checkout:${orderId}`;
    const session = await ctx.provider.createCheckout({
      orderId,
      orderNumber: order.order_number,
      amountPaise: Number(order.total_paise),
      idempotencyKey: key,
    });
    await tx.q.query(
      `INSERT INTO payments (order_id, provider, provider_ref, amount_paise, status, idempotency_key) VALUES ($1,$2,$3,$4,'INITIATED',$5)`,
      [orderId, ctx.provider.name, session.providerRef, Number(order.total_paise), key],
    );
    await tx.q.query(`UPDATE orders SET payment_status='INITIATED', updated_at=now() WHERE id=$1`, [orderId]);
    return { providerRef: session.providerRef, amountPaise: Number(order.total_paise), sandbox: true as const };
  });
}

export type WebhookOutcome = { status: 'processed' | 'duplicate'; result?: string };

/**
 * Verified webhook processing:
 *  1. verify the signature over the RAW body (throws -> 401),
 *  2. insert the external event id (UNIQUE) — a duplicate delivery is a safe no-op,
 *  3. apply the state change in the SAME transaction, validating the provider reference and amount,
 *  4. notify only AFTER commit.
 */
export async function processWebhook(
  ctx: AppContext,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): Promise<WebhookOutcome> {
  let event: VerifiedWebhookEvent;
  try {
    event = await ctx.provider.verifyWebhook({ rawBody, headers });
  } catch (e) {
    if (e instanceof WebhookSignatureError) throw new HttpError(401, 'INVALID_SIGNATURE', 'Invalid webhook signature');
    throw e;
  }
  return withTx(ctx, async (tx) => {
    const inserted = await tx.q.query(
      `INSERT INTO webhook_events (provider, external_event_id, event_type, payload) VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (provider, external_event_id) DO NOTHING RETURNING id`,
      [ctx.provider.name, event.externalId, event.type, JSON.stringify(event.raw)],
    );
    if (!inserted[0]) return { status: 'duplicate' as const };
    const result = await applyEvent(ctx, tx, event);
    await tx.q.query(`UPDATE webhook_events SET processed_at=now(), result=$2 WHERE id=$1`, [inserted[0].id, result]);
    return { status: 'processed' as const, result };
  });
}

async function applyEvent(ctx: AppContext, tx: Tx, event: VerifiedWebhookEvent): Promise<string> {
  if (event.type === 'refund.processed') {
    const r = await applyRefundProcessed(tx, event.providerRef);
    if (r.orderId) await notifyOrder(ctx, tx, r.orderId, false);
    return r.result;
  }

  const rows = await tx.q.query(
    `SELECT p.id AS payment_id, p.status AS payment_row_status, p.amount_paise AS payment_amount, o.*
       FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.provider_ref=$1 FOR UPDATE OF p, o`,
    [event.providerRef],
  );
  const row = rows[0];
  if (!row) return 'unknown_payment';
  // Never trust the amount in the event until it matches what we expected to collect.
  if (event.amountPaise !== undefined && event.amountPaise !== Number(row.payment_amount)) return 'amount_mismatch_ignored';

  if (event.type === 'payment.succeeded') {
    if (['SUCCEEDED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(row.payment_row_status)) return 'noop_already_succeeded';
    await tx.q.query(`UPDATE payments SET status='SUCCEEDED', updated_at=now() WHERE id=$1`, [row.payment_id]);

    if (row.status === 'PENDING_PAYMENT') {
      const [shop] = await tx.q.query(`SELECT accept_timeout_seconds FROM shops WHERE id=$1`, [row.shop_id]);
      const deadline = new Date(ctx.now().getTime() + shop.accept_timeout_seconds * 1000);
      await tx.q.query(
        `UPDATE orders SET status='AWAITING_VENDOR', payment_status='SUCCEEDED', accept_deadline=$2, updated_at=now() WHERE id=$1`,
        [row.id, deadline],
      );
      await tx.q.query(
        `INSERT INTO order_events (order_id, from_status, to_status, actor_type, reason) VALUES ($1,'PENDING_PAYMENT','AWAITING_VENDOR','WEBHOOK','Payment verified')`,
        [row.id],
      );
      await planSplits(tx.q, row, row.payment_id);
      await notifyOrder(ctx, tx, row.id, true);
      return 'payment_succeeded';
    }

    // Late success: the order was already cancelled/expired (e.g. failure event overtook it). Money was taken, so refund it.
    await tx.q.query(`UPDATE orders SET payment_status='SUCCEEDED', updated_at=now() WHERE id=$1`, [row.id]);
    await releaseSlot(tx.q, row.id);
    await initiateRefund(ctx, tx, {
      orderId: row.id,
      reason: 'Payment received after the order was closed',
      idempotencyKey: `auto:${row.id}`,
      actor: { type: 'WEBHOOK' },
    });
    await notifyOrder(ctx, tx, row.id, false);
    return 'late_success_refunded';
  }

  // payment.failed
  if (['SUCCEEDED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(row.payment_row_status)) return 'ignored_failure_after_success';
  if (row.payment_row_status === 'FAILED') return 'noop_already_failed';
  await tx.q.query(`UPDATE payments SET status='FAILED', updated_at=now() WHERE id=$1`, [row.payment_id]);
  await tx.q.query(`UPDATE orders SET payment_status='FAILED', updated_at=now() WHERE id=$1`, [row.id]);
  if (row.status === 'PENDING_PAYMENT') {
    // Unpaid order: closes the checkout and releases the slot. The vendor is never told about it.
    await transitionOrder(ctx, tx, row.id, 'CANCELLED', { type: 'WEBHOOK' }, { reason: 'Payment failed' });
  } else {
    await releaseSlot(tx.q, row.id);
  }
  return 'payment_failed';
}

async function notifyOrder(ctx: AppContext, tx: Tx, orderId: string, isNew: boolean) {
  const [o] = await tx.q.query(`SELECT * FROM orders WHERE id=$1`, [orderId]);
  tx.post.push(() =>
    ctx.bus.emitOrder({
      orderId,
      shopId: o.shop_id,
      userId: o.user_id,
      status: o.status,
      paymentStatus: o.payment_status,
      notifyVendor: o.payment_status === 'SUCCEEDED' || o.payment_status === 'REFUND_PENDING',
      kind: isNew ? 'NEW_ORDER' : 'UPDATE',
    }),
  );
}

/** SANDBOX ONLY. Stands in for the provider by sending a correctly signed webhook to our own processor. */
export function makeSandboxDeliver(ctx: AppContext, buildSigned: (e: { id: string; type: any; providerRef: string; amountPaise?: number }) => { body: Buffer; headers: Record<string, string> }) {
  return async (event: { type: any; providerRef: string; amountPaise?: number; eventId?: string }) => {
    const signed = buildSigned({
      id: event.eventId ?? `evt_${crypto.randomUUID()}`,
      type: event.type,
      providerRef: event.providerRef,
      amountPaise: event.amountPaise,
    });
    await processWebhook(ctx, signed.body, signed.headers);
  };
}
