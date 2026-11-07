/**
 * Provider-neutral marketplace payment interface. Business logic only talks to this interface so a
 * Cashfree Easy Split / Razorpay Route adapter can be added later WITHOUT touching order logic.
 *
 * Real adapters must be written against the provider's official documentation at that time, only after
 * provider approval for this exact multi-vendor food-pickup model, credentials and commercial terms exist.
 */

export interface CreateCheckoutInput {
  orderId: string;
  orderNumber: string;
  amountPaise: number;
  idempotencyKey: string;
}
export interface CheckoutSession {
  providerRef: string;
  /** Hosted checkout URL for real providers; null for the sandbox mock. */
  checkoutUrl: string | null;
}

export interface VerifyWebhookInput {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
}
export type WebhookEventType = 'payment.succeeded' | 'payment.failed' | 'refund.processed';
export interface VerifiedWebhookEvent {
  externalId: string;
  type: WebhookEventType;
  /** Provider payment reference (payment.*) or refund reference (refund.processed). */
  providerRef: string;
  amountPaise?: number;
  raw: unknown;
}

export type ProviderPaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface CreateRefundInput {
  providerPaymentRef: string;
  amountPaise: number;
  idempotencyKey: string;
  reason: string;
}
export interface RefundResult {
  providerRef: string;
  status: 'PENDING' | 'PROCESSED';
}

export interface VendorAccountInput {
  shopId: string;
  shopName: string;
}
export interface VendorAccountResult {
  accountRef: string;
}

export interface SplitInput {
  providerPaymentRef: string;
  shopAccountRef: string;
  vendorAmountPaise: number;
  platformAmountPaise: number;
}
export interface SplitResult {
  providerRef: string;
  status: 'PLANNED' | 'SETTLED';
}

export interface SettlementQuery {
  from: Date;
  to: Date;
}
export interface SettlementReport {
  lines: Array<{ externalRef: string; amountPaise: number; settledAt: string }>;
}

export class WebhookSignatureError extends Error {
  constructor(message = 'Invalid webhook signature') {
    super(message);
  }
}

export interface MarketplacePaymentProvider {
  readonly name: string;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /** Must verify the signature against the RAW body and throw WebhookSignatureError if invalid. */
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhookEvent>;
  getPaymentStatus(providerPaymentRef: string): Promise<ProviderPaymentStatus>;
  createRefund(input: CreateRefundInput): Promise<RefundResult>;
  createOrUpdateVendorAccount(input: VendorAccountInput): Promise<VendorAccountResult>;
  createSplitOrTransfer(input: SplitInput): Promise<SplitResult>;
  getSettlementReport(input: SettlementQuery): Promise<SettlementReport>;
}
