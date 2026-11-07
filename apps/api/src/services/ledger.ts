import { HttpError, audit, type AppContext, type Tx } from '../context.js';
import type { Queryable } from '../db.js';

export interface Actor {
  type: 'STUDENT' | 'VENDOR' | 'ADMIN' | 'SYSTEM' | 'WEBHOOK';
  id?: string;
  role?: string;
}

/** Planned vendor/platform/tax split for a paid order. Settlement is tracked separately from payment success. */
export async function planSplits(q: Queryable, order: any, paymentId: string) {
  const parts: Array<[string, number]> = [
    ['VENDOR', Number(order.subtotal_paise)],
    ['PLATFORM', Number(order.fee_paise)],
  ];
  if (order.tax_mode === 'EXCLUSIVE' && Number(order.tax_paise) > 0) parts.push(['TAX', Number(order.tax_paise)]);
  for (const [type, amount] of parts) {
    await q.query(
      `INSERT INTO payment_splits (order_id, payment_id, beneficiary_type, shop_id, amount_paise)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (order_id, beneficiary_type) DO NOTHING`,
      [order.id, paymentId, type, type === 'VENDOR' ? order.shop_id : null, amount],
    );
  }
}

/**
 * Create a refund exactly once per idempotency key. The provider call is made inside the DB transaction for the mock
 * provider; a real provider adapter should use an outbox so a failed network call never leaves a ledger gap.
 */
export async function initiateRefund(
  ctx: AppContext,
  tx: Tx,
  input: { orderId: string; amountPaise?: number; reason: string; idempotencyKey: string; actor: Actor },
) {
  const existing = await tx.q.query(`SELECT * FROM refunds WHERE idempotency_key=$1`, [input.idempotencyKey]);
  if (existing[0]) return existing[0];

  const payments = await tx.q.query(`SELECT * FROM payments WHERE order_id=$1 FOR UPDATE`, [input.orderId]);
  const payment = payments[0];
  if (!payment || !['SUCCEEDED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED'].includes(payment.status)) {
    throw new HttpError(409, 'NOTHING_TO_REFUND', 'This order has no successful payment to refund');
  }
  const [{ used }] = await tx.q.query<{ used: number }>(
    `SELECT COALESCE(SUM(amount_paise),0)::bigint AS used FROM refunds WHERE payment_id=$1 AND status <> 'FAILED'`,
    [payment.id],
  );
  const remaining = Number(payment.amount_paise) - Number(used);
  const amount = input.amountPaise ?? remaining;
  if (!Number.isInteger(amount) || amount <= 0) throw new HttpError(422, 'INVALID_REFUND', 'Refund amount must be a positive whole number of paise');
  if (amount > remaining) throw new HttpError(422, 'REFUND_EXCEEDS_PAYMENT', 'Refund exceeds the remaining refundable amount');

  const provider = await ctx.provider.createRefund({
    providerPaymentRef: payment.provider_ref,
    amountPaise: amount,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
  });
  const inserted = await tx.q.query(
    `INSERT INTO refunds (payment_id, order_id, amount_paise, reason, status, provider_ref, idempotency_key)
     VALUES ($1,$2,$3,$4,'PENDING',$5,$6) RETURNING *`,
    [payment.id, input.orderId, amount, input.reason, provider.providerRef, input.idempotencyKey],
  );
  await tx.q.query(`UPDATE payments SET status='REFUND_PENDING', updated_at=now() WHERE id=$1`, [payment.id]);
  await tx.q.query(`UPDATE orders SET payment_status='REFUND_PENDING', updated_at=now() WHERE id=$1`, [input.orderId]);
  await audit(tx.q, { id: input.actor.id, role: input.actor.role ?? input.actor.type }, 'REFUND_INITIATED', 'order', input.orderId, {
    amountPaise: amount,
    reason: input.reason,
  });
  if (ctx.sandboxDeliver) {
    const deliver = ctx.sandboxDeliver;
    tx.post.push(() => deliver({ type: 'refund.processed', providerRef: provider.providerRef, amountPaise: amount }));
  }
  return inserted[0];
}

/** Idempotent: a refund already PROCESSED is a no-op. */
export async function applyRefundProcessed(tx: Tx, refundRef: string): Promise<{ result: string; orderId?: string }> {
  const rows = await tx.q.query(`SELECT * FROM refunds WHERE provider_ref=$1 FOR UPDATE`, [refundRef]);
  const refund = rows[0];
  if (!refund) return { result: 'unknown_refund' };
  if (refund.status === 'PROCESSED') return { result: 'noop_already_processed', orderId: refund.order_id };
  await tx.q.query(`UPDATE refunds SET status='PROCESSED', processed_at=now() WHERE id=$1`, [refund.id]);
  const [payment] = await tx.q.query(`SELECT * FROM payments WHERE id=$1 FOR UPDATE`, [refund.payment_id]);
  const [{ done }] = await tx.q.query<{ done: number }>(
    `SELECT COALESCE(SUM(amount_paise),0)::bigint AS done FROM refunds WHERE payment_id=$1 AND status='PROCESSED'`,
    [payment.id],
  );
  const full = Number(done) >= Number(payment.amount_paise);
  const status = full ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  await tx.q.query(`UPDATE payments SET status=$2, updated_at=now() WHERE id=$1`, [payment.id, status]);
  await tx.q.query(`UPDATE orders SET payment_status=$2, updated_at=now() WHERE id=$1`, [refund.order_id, status]);
  if (full) await tx.q.query(`UPDATE payment_splits SET status='REVERSED' WHERE order_id=$1 AND status='PLANNED'`, [refund.order_id]);
  return { result: 'refund_processed', orderId: refund.order_id };
}
