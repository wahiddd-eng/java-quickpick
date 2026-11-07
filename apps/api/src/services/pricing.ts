import type { PricingPolicy } from '@quickpick/shared';
import { HttpError, type AppContext } from '../context.js';
import type { Queryable } from '../db.js';

const map = (r: any): PricingPolicy => ({
  id: r.id,
  version: r.version,
  feeRateBps: r.fee_rate_bps,
  taxMode: r.tax_mode,
  taxRateBps: r.tax_rate_bps,
  approved: r.approved,
});

/**
 * Active policy = highest version already in effect. Sandbox build: an unapproved policy is allowed (and flagged in the
 * UI) because no live payments exist; a live deployment must only ever use `approved = true` (CA sign-off).
 */
export async function getActivePolicy(ctx: AppContext, q: Queryable): Promise<PricingPolicy> {
  const rows = await q.query(`SELECT * FROM pricing_policies WHERE effective_from <= $1 ORDER BY version DESC LIMIT 1`, [ctx.now()]);
  if (!rows[0]) throw new HttpError(503, 'NO_PRICING_POLICY', 'No pricing policy is configured');
  return map(rows[0]);
}

export const policyRowToView = (r: any) => ({
  ...map(r),
  effectiveFrom: r.effective_from,
  note: r.note,
  createdAt: r.created_at,
});
