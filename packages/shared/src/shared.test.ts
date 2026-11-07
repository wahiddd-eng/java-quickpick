import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, ORDER_TRANSITIONS, canTransition, computeBreakdown, percentOfPaise } from './index';

const policy = { feeRateBps: 700, taxMode: 'NONE' as const, taxRateBps: 0, version: 1 };

describe('fee calculation (7% in integer paise)', () => {
  it('charges ₹7.00 on ₹100.00', () => {
    const b = computeBreakdown(10000, policy);
    expect(b.feePaise).toBe(700);
    expect(b.totalPaise).toBe(10700);
    expect(b.taxPaise).toBe(0);
  });

  it('rounds half-up to whole paise', () => {
    // 12550 * 7% = 878.5 -> 879
    expect(percentOfPaise(12550, 700)).toBe(879);
    // 7 * 7% = 0.49 -> 0 ; 8 * 7% = 0.56 -> 1
    expect(percentOfPaise(7, 700)).toBe(0);
    expect(percentOfPaise(8, 700)).toBe(1);
  });

  it('never yields fractional paise', () => {
    for (const subtotal of [1, 99, 1234, 9999, 123456]) {
      const b = computeBreakdown(subtotal, policy);
      expect(Number.isInteger(b.feePaise)).toBe(true);
      expect(Number.isInteger(b.totalPaise)).toBe(true);
    }
  });

  it('rejects non-integer or negative money', () => {
    expect(() => percentOfPaise(10.5, 700)).toThrow();
    expect(() => percentOfPaise(-1, 700)).toThrow();
  });

  it('supports EXCLUSIVE and INCLUSIVE fee-tax configuration without hard-coding a rate', () => {
    const ex = computeBreakdown(10000, { ...policy, taxMode: 'EXCLUSIVE', taxRateBps: 1800 });
    expect(ex.taxPaise).toBe(126); // 18% of 700
    expect(ex.totalPaise).toBe(10826);
    const inc = computeBreakdown(10000, { ...policy, taxMode: 'INCLUSIVE', taxRateBps: 1800 });
    expect(inc.totalPaise).toBe(10700); // total unchanged
    expect(inc.taxPaise).toBe(700 - Math.floor((700 * 10000) / 11800));
  });
});

describe('order state machine', () => {
  it('allows the happy path', () => {
    const path = ['PENDING_PAYMENT', 'AWAITING_VENDOR', 'ACCEPTED', 'PREPARING', 'READY', 'COLLECTED'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });

  it('rejects skips, regressions and moves out of terminal states', () => {
    expect(canTransition('PENDING_PAYMENT', 'READY')).toBe(false);
    expect(canTransition('AWAITING_VENDOR', 'PREPARING')).toBe(false);
    expect(canTransition('READY', 'PREPARING')).toBe(false);
    for (const t of ['COLLECTED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'NOT_COLLECTED'] as const) {
      expect(ORDER_TRANSITIONS[t]).toHaveLength(0);
    }
  });

  it('defines transitions for every status', () => {
    for (const s of ORDER_STATUSES) expect(ORDER_TRANSITIONS[s]).toBeDefined();
  });
});
