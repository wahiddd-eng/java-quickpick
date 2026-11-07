/**
 * Shared domain logic for Java QuickPick: money, fee policy and the order state machine.
 * All money is INTEGER PAISE. Never use floating-point rupees.
 */

// ---------- money ----------

export type Paise = number;

/** Percentage of an amount in basis points (1% = 100 bps), rounded half-up in integer math. */
export function percentOfPaise(amountPaise: Paise, bps: number): Paise {
  if (!Number.isInteger(amountPaise) || amountPaise < 0) throw new Error('amountPaise must be a non-negative integer');
  if (!Number.isInteger(bps) || bps < 0) throw new Error('bps must be a non-negative integer');
  return Math.floor((amountPaise * bps + 5000) / 10000);
}

export function formatPaise(paise: Paise): string {
  const rupees = paise / 100;
  return '₹' + rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- pricing policy ----------

/**
 * NONE      – no tax is charged on the convenience fee.
 * EXCLUSIVE – tax on the fee is added on top (shown as a separate line).
 * INCLUSIVE – the fee already contains tax; the tax part is informational.
 * No real tax treatment is approved yet (needs a CA opinion); these modes exist so it is configuration only.
 */
export type TaxMode = 'NONE' | 'INCLUSIVE' | 'EXCLUSIVE';

export interface PricingPolicy {
  id: string;
  version: number;
  feeRateBps: number;
  taxMode: TaxMode;
  taxRateBps: number;
  approved: boolean;
}

export interface PriceBreakdown {
  subtotalPaise: Paise;
  feeRateBps: number;
  feePaise: Paise;
  taxMode: TaxMode;
  taxRateBps: number;
  taxPaise: Paise;
  totalPaise: Paise;
  policyVersion: number;
}

export function computeBreakdown(
  subtotalPaise: Paise,
  policy: Pick<PricingPolicy, 'feeRateBps' | 'taxMode' | 'taxRateBps' | 'version'>,
): PriceBreakdown {
  const feePaise = percentOfPaise(subtotalPaise, policy.feeRateBps);
  let taxPaise = 0;
  let totalPaise = subtotalPaise + feePaise;
  if (policy.taxMode === 'EXCLUSIVE') {
    taxPaise = percentOfPaise(feePaise, policy.taxRateBps);
    totalPaise += taxPaise;
  } else if (policy.taxMode === 'INCLUSIVE') {
    const net = Math.floor((feePaise * 10000) / (10000 + policy.taxRateBps));
    taxPaise = feePaise - net;
  }
  return {
    subtotalPaise,
    feeRateBps: policy.feeRateBps,
    feePaise,
    taxMode: policy.taxMode,
    taxRateBps: policy.taxRateBps,
    taxPaise,
    totalPaise,
    policyVersion: policy.version,
  };
}

// ---------- order + payment state ----------

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'AWAITING_VENDOR',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'COLLECTED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
  'NOT_COLLECTED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'NOT_STARTED',
  'INITIATED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'DISPUTED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ['AWAITING_VENDOR', 'EXPIRED', 'CANCELLED'],
  AWAITING_VENDOR: ['ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COLLECTED', 'NOT_COLLECTED'],
  COLLECTED: [],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: [],
  NOT_COLLECTED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses after which the pickup slot reservation must be released and (if paid) the order refunded. */
export const RELEASING_STATUSES: readonly OrderStatus[] = ['REJECTED', 'CANCELLED', 'EXPIRED'];
/** Statuses the vendor tablet treats as "active work". */
export const VENDOR_ACTIVE_STATUSES: readonly OrderStatus[] = ['AWAITING_VENDOR', 'ACCEPTED', 'PREPARING', 'READY'];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Waiting for payment',
  AWAITING_VENDOR: 'Sent to shop',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready for pickup',
  COLLECTED: 'Collected',
  REJECTED: 'Rejected by shop',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  NOT_COLLECTED: 'Not collected',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  NOT_STARTED: 'Not paid',
  INITIATED: 'Payment started',
  PENDING: 'Payment pending',
  SUCCEEDED: 'Paid',
  FAILED: 'Payment failed',
  REFUND_PENDING: 'Refund in progress',
  PARTIALLY_REFUNDED: 'Partially refunded',
  REFUNDED: 'Refunded',
  DISPUTED: 'Disputed',
};

// ---------- API view types shared with the frontends ----------

export interface OrderItemView {
  menuItemId: string;
  name: string;
  unitPricePaise: Paise;
  quantity: number;
  lineTotalPaise: Paise;
}

export interface OrderView {
  id: string;
  orderNumber: string;
  pickupCode?: string;
  shopId: string;
  shopName?: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotalPaise: Paise;
  feeRateBps: number;
  feePaise: Paise;
  taxPaise: Paise;
  totalPaise: Paise;
  slotStartsAt: string;
  slotEndsAt: string;
  prepMinutes: number | null;
  acceptDeadline: string | null;
  expiresAt: string | null;
  customerName?: string;
  items: OrderItemView[];
  createdAt: string;
  updatedAt: string;
}
