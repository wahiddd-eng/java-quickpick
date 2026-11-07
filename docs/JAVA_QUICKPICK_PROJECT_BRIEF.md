# Java QuickPick — Project Brief, Product Specification & Claude Build Prompt

**Project:** Java QuickPick  
**Location:** Java food court, SRM Institute of Science and Technology, Kattankulathur (SRM KTR), Tamil Nadu, India  
**Document type:** Product brief + MVP requirements + technical plan + implementation prompt  
**Status:** Early validation; vendor interest secured; product not yet launched  
**Last updated:** 7 November 2026

> **Purpose of this document:** This is the working source of truth for planning and building Java QuickPick. It captures the business idea, current decisions, proposed user journeys, commercial model, technical architecture, MVP scope, risks, validation targets and a detailed prompt for Claude Code to begin implementation.
>
> **Important:** Legal, tax, FSSAI, payment-provider and university-permission details are not final approvals. The app must be built so these decisions can be configured and must use simulated/sandbox payments until the required professional advice, approvals and provider onboarding are complete.

---

## 1. Executive Summary

Java QuickPick is a campus food pre-ordering and scheduled-pickup platform for the Java food court at SRM KTR.

The food court has approximately **20 independent food shops**. Lunch is the busiest period. Students currently visit individual counters, wait to place orders and then wait for preparation. QuickPick aims to let students browse participating shops, order and pay online before reaching the outlet, select an available pickup window, and collect their food when it is ready.

Each participating shop receives a dedicated Android tablet running a simple vendor dashboard. The vendor can accept or reject orders, set preparation times, update order status, mark products unavailable, pause incoming orders and hand over completed orders. QuickPick provides the student-facing application, vendor software, admin dashboard, equipment (on a loan basis), support and order coordination.

### Current validation status

- The founder/team pitched the concept to shops at Java.
- **Two independent shops agreed on the spot.**
- **Two additional shops said they would decide after discussing internally.**
- The food court has approximately 20 shops; the remaining shops have not yet been onboarded.
- The team can approach the vendors directly.
- Lunch is the identified peak period.
- Vendor daily order volume, average bill value, preparation capacity and peak-hour data have **not yet been collected**.
- There is no confirmed student demand or completed transaction data yet.

These are early positive signals, not proof of product-market fit. Verbal interest must be converted into written pilot participation agreements.

### Product promise

**Order ahead. Pick up on time. Skip the ordering queue.**

QuickPick should reduce time spent waiting to place an order. It must not promise instant preparation or guaranteed queue elimination. Pickup capacity must reflect each shop's actual kitchen capacity.

---

## 2. Business Model and Commercial Decisions

### 2.1 Roles

1. **Student/customer:** Uses the app to browse, order and pay online, then collects from the relevant shop.
2. **Independent food vendor:** Owns and operates the shop, controls food preparation, menu availability and base menu prices, and fulfils QuickPick orders.
3. **Java QuickPick platform:** Supplies the marketplace/application, vendor dashboards, tablets on loan, order orchestration, customer support and agreed platform service.
4. **SRM / food-court management:** Must provide any required permission for operating, promoting, placing equipment or QR signage on campus. The university is not assumed to be a business partner or sponsor.
5. **Payment provider:** Must approve the marketplace model and provide an appropriate compliant payment collection, split/settlement and refund flow.

### 2.2 Confirmed commercial intention: customer-paid 7% convenience premium

The founder clarified that the student pays approximately **7% more in the app than the same food's shop price**, and selected the following allocation:

- Vendor receives the agreed original food/menu price for the completed order, subject to the final lawful tax and settlement treatment.
- QuickPick's gross commercial fee is 7% of the eligible food subtotal.
- QuickPick does **not** additionally deduct another 7% vendor commission.
- Walk-in customers do not pay QuickPick anything.
- Students do not pay a subscription during the initial model.
- The student-facing price must show the charge clearly before checkout.

**Illustration only:** If the shop's agreed food subtotal is ₹100, the proposed QuickPick fee is ₹7 and the illustrative pre-tax/adjustment total is ₹107. The vendor's commercial food-price entitlement is ₹100, and QuickPick's gross fee collection is ₹7. This is not a final tax invoice or guaranteed bank payout. Tax, payment charges, refunds and settlement mechanics remain subject to professional review and payment-provider approval.

### 2.3 Pricing calculation

Initial intended formula:

`quickpick_fee = eligible_food_subtotal × 0.07`

`customer_total = eligible_food_subtotal + quickpick_fee + other legally required disclosed charges/taxes`

Use integer paise in all code, never floating-point rupees. Example: ₹100.00 = `10000` paise.

Pricing must be configurable from the admin side. Do not hard-code 7% throughout the codebase. Store a pricing-policy version and snapshot the applicable rate and calculated amounts against each order.

**Unresolved pricing/tax issue:** The team has not yet received a CA's written opinion on whether the 7% fee is a separate platform service, how GST applies to it, whether it should be displayed inclusive or exclusive of applicable GST, and the exact invoice treatment. The product should support both inclusive-fee and additional-tax configurations, but no live price/tax treatment should be enabled until approved. Do not silently add GST at the final checkout screen.

### 2.4 Example customer price presentation

For an item with a shop price of ₹100, the UI may show (after the approved tax treatment is decided):

- Food subtotal: ₹100.00
- QuickPick convenience fee (7%): ₹7.00
- Applicable taxes/other charges: calculated and disclosed as configured
- Total payable: clearly shown before the payment action

The app must not show ₹100 on the menu and unexpectedly change to ₹107 only at final payment. The full payable price or an immediately understandable price breakdown must be visible before the student commits to checkout.

### 2.5 Refund and cancellation principles

- Rejected or unaccepted orders: do not prepare; initiate the configured full refund process.
- Payment failure: do not send an order to the kitchen as paid.
- Duplicate payment/webhook: never create duplicate orders or settlements.
- Partial refund: recalculate fee and vendor entitlement proportionately according to the approved policy.
- Vendor-caused unavailability after payment: notify customer and process the approved refund/adjustment.
- Student cancellation and no-show policies must be written, reasonable and displayed before payment. Do not invent punitive fees.
- Refund status must be visible to the student and recorded in the admin/financial ledger.

### 2.6 No delivery in the MVP

QuickPick is a **pre-order and pickup** platform. It does not employ delivery workers, deliver food, own kitchens, purchase food inventory or operate the food stalls. Delivery is explicitly out of scope for the MVP.

### 2.7 Vendor hardware arrangement

QuickPick intends to provide dedicated Android tablets to participating vendors at no initial rental charge during the pilot. Tablets remain QuickPick property and are loaned to vendors under a separate equipment agreement. Include device assignment, asset tag, condition, handover date, return obligation and damage/loss terms. Do not describe tablets as gifts or transfer ownership by default.

---

## 3. Goals, Non-Goals and Success Metrics

### 3.1 MVP goals

- Let a student discover participating Java shops and browse their menus.
- Let a student place a single-shop order and pay online through a provider-approved flow.
- Let a student select an available pickup slot.
- Route the order to the correct vendor tablet.
- Let the vendor accept/reject, prepare, mark ready and mark collected.
- Notify the student of order status.
- Prevent a shop from receiving more pre-orders than it can handle per slot.
- Give the admin visibility into shops, menus, devices, orders, payments, refunds and basic reports.
- Support two initial shops and scale the same design to approximately 20 shops.
- Provide an auditable financial ledger and reconciliation records.

### 3.2 Non-goals for initial MVP

Do not build these unless the founder explicitly changes scope:

- Food delivery or delivery-agent tracking.
- Multi-vendor cart / one checkout containing items from multiple shops.
- Native Android or iOS applications (use mobile-first PWA initially).
- AI recommendations, loyalty points, coupons, gamification or referral rewards.
- Customer wallet or stored-value balance.
- Complex ERP, inventory forecasting or POS replacement.
- Franchise/other campus expansion.
- Public marketplace for non-food products.
- Automated accounting/tax filing.

### 3.3 Proposed pilot success targets

These are **targets**, not measured results or guarantees:

- 2 signed and active pilot vendors initially; expand to 3 if another vendor joins.
- 50–100 student trial users.
- At least 100 completed real orders after required approvals.
- At least 85% of accepted orders ready within the promised pickup window.
- Repeat purchase rate of at least 25% during the pilot measurement period.
- Uncollected orders below 10%.
- Vendors willing to continue after the trial.
- Demonstrable reduction in time spent waiting to place an order, without creating an equivalent pickup queue.
- Positive contribution per completed order after variable payment costs and applicable taxes are understood.

Measure baseline queue and service time before the pilot. Do not claim queue reduction without a before/after measurement.

---

## 4. Users and Permissions

### 4.1 Student

- Browse shops and their availability.
- Browse menu categories and products.
- See base shop prices and QuickPick fee clearly.
- Add items from one shop to cart.
- Choose a pickup slot.
- Initiate online payment.
- See payment and order status.
- Receive ready notification.
- View order history and receipts/invoices as appropriate.
- Raise an order-related support request.

### 4.2 Vendor owner/manager

- Access only their own shop.
- View incoming orders.
- Accept or reject within an acceptance window.
- Set preparation estimate where allowed.
- Change order status.
- Mark a product out of stock / pause item.
- Pause new QuickPick orders or set shop unavailable.
- Configure capacity/slot settings if authorised.
- View their own order and settlement summaries.
- Never view another vendor's customer/order data or payment details.

### 4.3 Admin/operator

- Create, edit, activate, suspend and onboard shops.
- Create vendor accounts and assign shop permissions.
- Manage menus and help vendors update them.
- Manage student/customer support.
- View all orders and order events.
- View payment, refund and settlement reconciliation.
- Assign and revoke tablets.
- Configure the service fee and approved tax/pricing policy.
- Configure pickup slots and operational limits.
- Export reports.
- Keep an audit trail for sensitive actions.

### 4.4 Platform owner/super-admin

- Full configuration and role management.
- Manage admin accounts and access.
- Manage provider credentials via secure environment/secret storage.
- Review financial and operational audit logs.

Use role-based access control and server-side authorisation for every protected resource. Frontend hiding alone is not security.

---

## 5. Core User Journeys

### 5.1 Student order journey

1. Student opens the Java QuickPick PWA through a URL/QR code.
2. Student signs in (the exact SRM verification approach is configurable; do not assume a specific university SSO/API exists).
3. Student sees active participating shops.
4. Student selects one shop.
5. Student views that shop's menu, availability and clearly displayed prices.
6. Student adds one or more items from that shop to the cart.
7. Backend revalidates product availability, prices and pickup capacity.
8. Student selects an available pickup slot.
9. Backend creates a time-limited checkout/order reservation.
10. Student completes online payment using the approved provider's hosted checkout/SDK.
11. Backend verifies payment using a signed webhook and, where appropriate, provider API verification.
12. Order becomes paid/awaiting vendor acceptance and appears on the assigned vendor tablet.
13. Vendor accepts or rejects. The customer sees status changes.
14. Vendor marks Preparing, then Ready.
15. Student receives notification and goes to the shop's pickup point.
16. Vendor validates order number/QR/pickup PIN and marks Collected.
17. Order and payment records are reconciled.

### 5.2 Vendor order journey

- Tablet is assigned to the vendor and logged into its shop account.
- Dashboard shows clear shop status (online/offline) and connection status.
- New order triggers sound + visible alert.
- Order card shows order ID, items, quantities, notes (if supported), amount, paid status and pickup slot.
- Vendor accepts or rejects within configurable time.
- Vendor can set realistic preparation estimate.
- Vendor marks Preparing and Ready.
- Customer collects using a short order code or QR/PIN.
- Vendor marks Collected.
- Vendor can pause incoming orders and toggle menu item availability.

### 5.3 Admin journey

- Onboard shop and vendor.
- Record vendor business/FSSAI details as required.
- Review and approve shop menu.
- Assign tablet/device ID.
- Configure pickup slot length and capacity.
- Monitor orders in progress.
- Handle complaints/refunds in accordance with policy.
- Review daily reconciliation and settlement reports.

---

## 6. Order State and Payment State Models

Keep **order status** and **payment status** separate.

### 6.1 Order status (suggested)

- `PENDING_PAYMENT` — checkout started; payment not verified.
- `AWAITING_VENDOR` — payment verified; vendor acceptance pending.
- `ACCEPTED` — vendor accepted.
- `PREPARING` — vendor is preparing.
- `READY` — ready for pickup.
- `COLLECTED` — handed over to customer.
- `REJECTED` — vendor rejected.
- `CANCELLED` — valid cancellation.
- `EXPIRED` — checkout/acceptance deadline passed according to policy.
- `NOT_COLLECTED` — customer did not collect within the disclosed grace period; policy determines outcome.

Only allow valid transitions. Record every transition with actor, timestamp and reason.

### 6.2 Payment status (suggested)

- `NOT_STARTED`
- `INITIATED`
- `PENDING`
- `SUCCEEDED`
- `FAILED`
- `REFUND_PENDING`
- `PARTIALLY_REFUNDED`
- `REFUNDED`
- `DISPUTED` (if provider exposes this status)

Never mark a payment successful based only on a browser redirect. Verify signed provider webhooks and/or provider API status. Handle webhook retries idempotently.

### 6.3 Vendor acceptance timeout

A proposed 60–90 second response window was discussed, but this must be configurable and tested with the vendors. If the vendor does not respond, automatically cancel/refund according to the approved policy. Do not send unpaid orders to preparation.

---

## 7. Pickup Slot and Capacity Management

Capacity management is essential. QuickPick must not create a digital queue that simply moves the waiting problem into the kitchen.

Each shop should have configurable:

- Operating hours.
- Pickup slot duration (e.g. 10 minutes).
- Maximum accepted orders per slot.
- Optional item-specific prep constraints in a later phase.
- Buffer/preparation time.
- Temporary pause/unavailable state.
- Acceptance timeout.

Example only (must be tuned per outlet):

| Pickup window | Maximum QuickPick orders |
|---|---:|
| 12:30–12:40 | 5 |
| 12:40–12:50 | 7 |
| 12:50–1:00 | 7 |
| 1:00–1:10 | 8 |

Capacity reservation must be concurrency-safe. Two students attempting to book the last available slot simultaneously must not exceed capacity. Use a database transaction/locking or another proven atomic reservation strategy. Reserve capacity temporarily during checkout; release it if payment fails/expires; confirm reservation when payment is verified. Avoid double-counting on duplicate webhooks.

---

## 8. Product Features and Requirements

### 8.1 Student PWA

**Must have**

- Mobile-first responsive design.
- Java QuickPick identity and Java food court landing page.
- List of active shops.
- Shop status/open indicator.
- Menu categories and product cards.
- Product name, description (optional), image (optional), price and availability.
- Cart for one shop only.
- Quantity controls.
- Order subtotal and 7% convenience fee breakdown.
- Applicable taxes/other charges shown according to approved configuration.
- Pickup time selection.
- Checkout and online payment provider integration (sandbox first).
- Order confirmation and status page.
- Order history.
- Order number/pickup code.
- Support/contact link.

**Should have**

- Search shops/items.
- Repeat previous order.
- Student email/phone verification.
- Accessible touch targets and readable status labels.
- PWA install prompt.

### 8.2 Vendor tablet PWA

**Must have**

- Tablet-optimised layout in landscape and portrait.
- Vendor login and shop-scoped permissions.
- New order alert with sound and visual indicator.
- New/Accepted/Preparing/Ready order columns or tabs.
- Clear order details and pickup slot.
- Accept/reject actions.
- Preparation time/status updates.
- Ready and Collected actions.
- Pause shop / busy mode.
- Item availability toggle.
- Internet connectivity indicator and reconnection handling.
- Refresh/recover after browser reload.
- Simple daily order summary.

**Should have**

- Optional printer integration in a later release.
- Vendor settlement statement view.
- Order search by ID.
- Tablet full-screen/kiosk setup instructions.

### 8.3 Admin dashboard

**Must have**

- Dashboard overview.
- Shop CRUD and activation/suspension.
- Vendor users and role assignment.
- Menu and category management.
- Order monitor across all shops.
- Order timeline/audit events.
- Payment status view.
- Refund initiation/status view (via provider abstraction and permissions).
- Pricing policy configuration and version history.
- Pickup slot/capacity configuration.
- Device registry/assignment/last-seen status.
- Daily order, GMV, fee and settlement summary.
- Data export (CSV) for initial operations.

### 8.4 Notifications

MVP priority:

- Real-time in-app vendor dashboard alert via Socket.IO while connected.
- Sound alert on tablet when a new order arrives.
- Student status updates while application is open.
- SMS/email/push notifications can be added through a provider abstraction after testing and budget review.

Do not rely only on browser push notifications. Keep reconnect/polling fallback so an order is still visible after network interruption.

### 8.5 Support and complaints

- Student can raise an issue against an order.
- Admin can record issue category, notes, status and resolution.
- Keep a grievance/contact process visible.
- Do not expose vendor or customer personal information unnecessarily.

---

## 9. Recommended Technical Architecture

### 9.1 Proposed stack

Use the following unless the existing repository contains a sensible established alternative:

- **Frontend:** React + Vite + TypeScript.
- **Student app:** React Progressive Web App (PWA), mobile-first.
- **Vendor dashboard:** React PWA, tablet-first.
- **Admin dashboard:** React web application.
- **Backend:** Node.js + Express + TypeScript.
- **Database:** PostgreSQL.
- **ORM/migrations:** Prefer Prisma or Drizzle; inspect existing repo and choose one, do not introduce multiple ORMs.
- **Realtime:** Socket.IO or a similarly straightforward WebSocket layer.
- **Validation:** Zod or equivalent shared runtime validation.
- **Authentication:** Secure session/JWT approach with role-based access. OTP provider can be abstracted; use a development-only mock, never a hard-coded production OTP.
- **Hosting:** Select a simple reliable deployment suitable for a pilot. Vercel for frontend and a managed Node host/database are options, but final provider should be configurable.
- **Monitoring:** Structured logs and error tracking abstraction; never log secrets, OTPs or full payment data.

### 9.2 Architecture principle

Use a **modular monolith**, not microservices. The first deployment needs to be easy to understand, test and maintain.

Suggested logical modules:

- `auth`
- `users`
- `shops`
- `vendors`
- `menus`
- `cart` (client-side cart; server revalidates)
- `pickup-slots`
- `orders`
- `payments`
- `refunds`
- `settlements`
- `devices`
- `notifications`
- `admin`
- `audit`
- `support`

### 9.3 High-level architecture

```text
Student PWA  ───────────────┐
                            │
Vendor Tablet PWA ──────────┼── Express API ─── PostgreSQL
                            │        │
Admin Dashboard ────────────┘        ├── Socket.IO events
                                     ├── Payment provider adapter
                                     ├── Notification adapter
                                     └── Background jobs / expiry / reconciliation

Payment provider webhooks ───────────────> Verified webhook endpoint
```

PostgreSQL is the source of truth. Socket.IO communicates state changes; it is not the order database.

### 9.4 Suggested repository structure

Use a monorepo if starting from scratch:

```text
java-quickpick/
├── apps/
│   ├── student-web/
│   ├── vendor-web/
│   ├── admin-web/
│   └── api/
├── packages/
│   ├── shared-types/
│   ├── validation/
│   ├── ui/                 # only if sharing UI is useful
│   └── config/
├── prisma/                 # or chosen ORM schema/migrations
├── docs/
│   ├── architecture.md
│   ├── api-contracts.md
│   ├── data-model.md
│   └── operational-runbook.md
├── .env.example
├── README.md
└── package.json
```

Do not force this structure if the existing repository already has an established layout. Inspect first.

---

## 10. Proposed Data Model

This is the initial conceptual schema. Refine field types, indexes, constraints and relations during implementation.

| Entity/table | Purpose / key fields |
|---|---|
| `users` | `id`, name, phone/email, role/status, created_at |
| `shops` | `id`, name, description, owner contact, status, opening hours, FSSAI details where required |
| `shop_members` | `user_id`, `shop_id`, role, status; supports owner/manager staff |
| `categories` | `id`, `shop_id`, name, sort_order, active |
| `menu_items` | `id`, `shop_id`, `category_id`, name, description, base_price_paise, availability, image, prep metadata |
| `devices` | `id`, `shop_id`, asset_tag, device type/model, status, last_seen_at, assigned_at, returned_at |
| `pickup_slots` | `id`, `shop_id`, starts_at, ends_at, capacity, reserved_count/derived count, status |
| `orders` | `id`, human-readable order number, `user_id`, `shop_id`, order status, payment status, slot, subtotal_paise, fee_paise, tax/charge snapshot, total_paise, price-policy version, timestamps |
| `order_items` | `id`, `order_id`, `menu_item_id`, item name snapshot, unit price snapshot, quantity, line total, notes if supported |
| `order_events` | `id`, order_id, previous/new status, actor, reason, timestamp |
| `payments` | `id`, order_id, provider, provider payment/order reference, amount_paise, status, idempotency key, timestamps |
| `payment_splits` | order/payment reference, beneficiary type/ID, amount_paise, split status, provider transfer reference |
| `refunds` | order/payment, amount_paise, reason, provider reference, status, timestamps |
| `settlements` | vendor, provider settlement reference, period, gross/adjustment/net amount, status |
| `settlement_reconciliation` | external reference, expected amount, actual amount, difference, reconciliation status, notes |
| `webhook_events` | provider, external event ID unique, event type, received_at, processed_at, processing result |
| `pricing_policies` | fee rate, inclusive/exclusive tax configuration, effective dates, version, approved status |
| `complaints` | order, customer, category, description, status, resolution and audit fields |
| `audit_logs` | actor, action, entity type/ID, timestamp, safe metadata |

### Data-model rules

- Store currency as integer paise (`BIGINT`/safe integer); never use floating-point values for money.
- Snapshot item names/prices and fee policy on each order. Historical order amounts must not change when menus or fee rules are updated.
- Store base food subtotal, QuickPick fee, each tax/charge line, discount/refund and total as separate values.
- Do not hard-code a GST rate or assume a specific tax allocation until CA advice is approved.
- Provider account IDs and references are not bank credentials; store only the minimum provider identifiers needed.
- Never store card data, UPI PINs or payment secrets.
- Index shop/status/pickup time, user/order history, provider references and webhook event IDs.
- Add database constraints for non-negative amounts, valid quantities and unique references.
- Implement tenant isolation at the service/query layer and test cross-shop access denial.

---

## 11. Initial API Contract

Use versioned REST endpoints (e.g. `/api/v1`). Names may be refined but keep the API consistent and documented.

### Student/public

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/shops` | List currently participating/available shops |
| `GET` | `/api/v1/shops/:shopId` | Shop details and status |
| `GET` | `/api/v1/shops/:shopId/menu` | Menu/categories/items |
| `GET` | `/api/v1/shops/:shopId/pickup-slots` | Available pickup windows |
| `POST` | `/api/v1/orders/quote` | Server-side quote; validates menu, fee and pickup capacity |
| `POST` | `/api/v1/orders` | Create checkout reservation/order using idempotency key |
| `POST` | `/api/v1/payments/checkout` | Create provider checkout session (sandbox initially) |
| `GET` | `/api/v1/orders/:orderId` | Order status/details for authorised user |
| `GET` | `/api/v1/me/orders` | Student order history |
| `POST` | `/api/v1/orders/:orderId/cancel` | Request cancellation where policy permits |
| `POST` | `/api/v1/orders/:orderId/support` | Raise issue |

### Vendor

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/vendor/orders` | Shop-scoped active/recent orders |
| `POST` | `/api/v1/vendor/orders/:orderId/accept` | Accept order |
| `POST` | `/api/v1/vendor/orders/:orderId/reject` | Reject with reason |
| `PATCH` | `/api/v1/vendor/orders/:orderId/status` | Preparing / Ready / Collected transitions |
| `PATCH` | `/api/v1/vendor/menu-items/:itemId` | Availability/limited item edits |
| `PATCH` | `/api/v1/vendor/shop/status` | Pause/resume shop ordering |
| `GET` | `/api/v1/vendor/summary` | Daily order and settlement summary |
| `GET` | `/api/v1/vendor/settlements` | Vendor settlement statement |

### Admin

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/v1/admin/shops` | Create shop |
| `PATCH` | `/api/v1/admin/shops/:shopId` | Update/suspend shop |
| `POST` | `/api/v1/admin/vendors` | Invite/create vendor |
| `POST` | `/api/v1/admin/devices/assign` | Assign tablet to shop |
| `GET` | `/api/v1/admin/orders` | Platform-wide order monitoring |
| `GET` | `/api/v1/admin/payments` | Payment list/reconciliation |
| `POST` | `/api/v1/admin/refunds` | Initiate authorised refund |
| `GET` | `/api/v1/admin/analytics` | Operational/business metrics |
| `PATCH` | `/api/v1/admin/pricing-policy` | Create a new fee/tax policy version |

### Payment provider webhooks

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/v1/webhooks/payments/:provider` | Verify signature, deduplicate and process provider events |

Webhook handling must:

1. Verify signature using the raw request body and provider secret.
2. Reject invalid signatures.
3. Store the external event ID with a unique constraint.
4. Return safely for duplicate events.
5. Update payment/order state transactionally.
6. Avoid trusting amount, order ID or status fields until provider authenticity and expected values have been verified.
7. Trigger vendor notification only after verified successful payment.
8. Reconcile eventual settlement separately from payment success.

---

## 12. Payment Provider Integration Strategy

The team previously identified **Cashfree Easy Split** and **Razorpay Route** as providers to evaluate for marketplace collections and vendor settlements. These are candidates, not selected/approved providers.

Requirements for provider selection:

- Explicit approval for this multi-vendor food marketplace/click-and-collect business model.
- Vendor/linked-account onboarding process for independent shops.
- UPI and other needed online payment methods.
- Correct marketplace split/transfer functionality.
- Vendor settlement schedule and reporting.
- Refund and partial-refund support.
- Webhook signing and retry semantics.
- Clear fees for collection, transfer/split, refunds, chargebacks and settlement.
- Reconciliation reports and support escalation.
- Written confirmation of permitted fund flow and any reserve/hold policy.

**Do not build around a personal UPI ID or a normal single-merchant payment flow that requires the founder to manually forward vendors' money.**

### Payment adapter design

Create a provider-neutral interface, for example:

```ts
interface MarketplacePaymentProvider {
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhookEvent>;
  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus>;
  createRefund(input: CreateRefundInput): Promise<RefundResult>;
  createOrUpdateVendorAccount(input: VendorAccountInput): Promise<VendorAccountResult>;
  createSplitOrTransfer(input: SplitInput): Promise<SplitResult>;
  getSettlementReport(input: SettlementQuery): Promise<SettlementReport>;
}
```

Implement a **mock/sandbox provider first**. Use environment variables and provider-specific adapters. Never put API keys/secrets in source control or frontend code.

### Sandbox-first rule

- Use test credentials and simulated payment events.
- Use no real student funds during development.
- The system must be able to switch providers without rewriting order logic.
- A real provider adapter is not considered production-ready until webhook signatures, refunds, split settlement and reconciliation tests pass.

---

## 13. Financial Model and Assumptions

These are scenario calculations based on an assumed average food order of ₹120, 7% gross fee and 26 operating days. They are not forecasts; vendor sales data has not been collected.

| Daily QuickPick orders (all shops) | Monthly orders | Monthly food GMV | Gross 7% fee |
|---:|---:|---:|---:|
| 20 | 520 | ₹62,400 | ₹4,368 |
| 40 | 1,040 | ₹1,24,800 | ₹8,736 |
| 125 | 3,250 | ₹3,90,000 | ₹27,300 |
| 400 | 10,400 | ₹12,48,000 | ₹87,360 |
| 800 | 20,800 | ₹24,96,000 | ₹1,74,720 |

Formula:

`monthly_gross_fee = daily_orders × operating_days × average_food_order_value × 0.07`

These gross fee values are **not profit**. Subtract applicable output GST on QuickPick's fee, payment-provider collection/split costs, refunds/chargebacks, hosting, SMS/notification, tablet amortisation/maintenance, field support, legal/accounting costs, marketing and other operating expenses.

Restaurant-service GST under the applicable e-commerce-operator rules must be calculated and recorded separately from the QuickPick service fee. Obtain a CA's written treatment before relying on any payout example.

### Hardware planning allowance

Indicative initial per-shop tablet kit previously discussed:

| Item | Budget estimate |
|---|---:|
| Android tablet (8–10 inch, 4GB RAM, 64GB storage, Wi-Fi) | ₹9,000–12,000 |
| Protective case | ₹400–700 |
| Stand | ₹500–900 |
| Screen protector | ₹150–250 |
| Charging accessories | ₹300–500 |
| **Indicative total per shop** | **₹10,350–14,350** |

Two-shop hardware planning allowance: approximately ₹20,700–28,700. Prices must be checked with current suppliers and procurement should wait until agreements/permissions and the pilot device requirements are confirmed.

Optional thermal printers are out of MVP scope. Add only if the vendor pilot demonstrates a need and Bluetooth/network compatibility is tested.

### Operating cost categories to track

- Payment gateway collection/split charges.
- GST on provider services where applicable.
- Platform service GST and restaurant-service GST obligations.
- Hosting, database, backups and monitoring.
- SMS/OTP/push notification costs.
- Tablet depreciation/amortisation and repair reserve.
- Vendor onboarding and campus field support.
- Customer support and refunds.
- CA, legal, FSSAI and business registration costs.
- Marketing and QR signage.

---

## 14. Hardware and Device Management

### Recommended tablet specification

- 8–10 inch Android tablet.
- Android 13 or newer where practical.
- Minimum 4GB RAM and 64GB storage.
- Reliable dual-band Wi-Fi.
- USB-C charging.
- Suitable screen brightness and touch responsiveness.
- Protective case and counter stand.
- Manufacturer warranty.

### Device requirements

- Tablet belongs to QuickPick and is loaned to the shop.
- Each device has a unique asset tag and database record.
- Device assigned to one shop at a time.
- Vendor account access is shop-scoped.
- No personal Google account or sensitive user data should be stored unnecessarily.
- Use browser kiosk/full-screen mode or managed-device controls where feasible.
- Lock the device and provide a recovery procedure.
- Record handover/return condition.
- Vendor must notify QuickPick of loss, damage or relocation.
- Device should reconnect after Wi-Fi loss and load pending active orders from the API.
- Do not rely only on a live WebSocket event; the dashboard must reload active order state from the database after reconnect.

---

## 15. Security, Privacy and Reliability Requirements

### Security

- HTTPS in all non-local environments.
- Secure authentication, short-lived access tokens/session and refresh strategy as appropriate.
- Hash passwords using a modern password hashing algorithm if passwords are used.
- OTP rate limiting and abuse protection if OTP is used.
- Role-based authorization enforced server-side.
- Vendor tenant isolation enforced on every query/action.
- Validate all user input on the server.
- Protect against CSRF/XSS/SQL injection and insecure direct object reference.
- Store secrets in environment/secret manager; provide `.env.example` with placeholders only.
- Never log credentials, payment secrets, OTPs or full sensitive payment data.
- Rate-limit sensitive endpoints.
- Audit admin actions and financial adjustments.
- Verify payment webhooks cryptographically.
- Use idempotency keys for order creation, payments, refunds and webhook processing.

### Privacy

- Collect only necessary customer information.
- Explain data use in a privacy notice.
- Limit vendor access to information needed to fulfil an order.
- Never expose student phone/email to other vendors.
- Define retention/deletion rules with professional advice.
- Do not send marketing messages without appropriate consent.

### Reliability

- PostgreSQL is authoritative for order/payment state.
- Use database transactions for order creation and pickup capacity reservation.
- Use retry-safe background jobs.
- WebSocket reconnect plus REST refresh/polling fallback.
- Handle tablet browser reload and network loss.
- Add database backups and a restore procedure.
- Keep a health endpoint and structured logs.
- Make order status changes auditable.

---

## 16. Legal, Tax, Campus and Operational Dependencies

These items must be treated as pre-launch gates, not assumptions.

### 16.1 University/campus permission

Obtain written permission from the appropriate SRM authority and food-court management for:

- Operating a digital ordering service at Java.
- Vendor participation and signage/QR codes.
- Placing tablets/stands at outlets.
- Promoting to students or distributing QR codes.
- Any separate pickup shelf/counter.
- Use of university/trade names, logos or branding.

Vendor agreement alone may not be sufficient to use campus premises or branding.

### 16.2 FSSAI

Because the proposed platform lists food vendors and facilitates online orders/transactions, QuickPick may be treated as an e-commerce food business operator. The exact licence category, central licence requirement, applicability and responsibilities must be confirmed through FoSCoS/FSSAI and a qualified professional before live transactions. Collect and verify each vendor's applicable FSSAI registration/licence details. Do not claim that being a software intermediary automatically exempts the platform.

### 16.3 GST and invoices

The applicable Indian GST rules for restaurant services supplied through an e-commerce operator, including Section 9(5), may place restaurant-service tax collection/payment and invoice responsibilities on the operator. QuickPick's separate convenience/platform fee may have a distinct GST treatment. The precise structure depends on the actual legal and payment model.

Obtain written advice from a CA experienced with e-commerce/food marketplaces covering:

- Whether QuickPick is an electronic commerce operator for the proposed arrangement.
- Section 9(5) applicability and tax calculation.
- Invoice issuer and invoice format for the restaurant service.
- Tax-inclusive vs tax-exclusive vendor menu prices.
- GST treatment of the 7% convenience fee.
- QuickPick registration and reporting obligations.
- Vendor settlement and reconciliation.
- How refunds and discounts affect taxable values.

### 16.4 Payment provider approval

Obtain written confirmation that the provider will onboard this exact multi-vendor food pickup marketplace and support its split/settlement flow. Confirm the approved money flow, linked vendor onboarding, fees, refunds, settlement time and documentation.

### 16.5 Business and contracts

Before commercial operation, obtain appropriate professional advice on entity formation, founder ownership, vendor agreements, equipment-loan agreements, terms of service, privacy policy, cancellation/refund policy and liability allocation.

---

## 17. Vendor Onboarding Plan

### First group

- Two vendors have verbally agreed.
- Two more are considering.
- Aim to secure written participation from the first two, then onboard a third if available.
- Do not wait for all 20 shops before testing.

### Vendor onboarding checklist

- Shop name and owner/authorised contact.
- Contact details and operating hours.
- Menu and categories.
- Item names, descriptions, prices and availability.
- Food photographs/permission to use them (optional for initial pilot).
- Typical preparation time.
- Maximum orders the kitchen can handle per slot.
- Peak-hour order-volume estimate.
- FSSAI details and other required business information.
- Bank/provider linked-account onboarding through approved provider.
- Signed vendor pilot/commercial agreement.
- Signed equipment-loan agreement.
- Tablet handover/asset record.
- Training and test order.

### Suggested vendor questions

1. Approximately how many customer orders do you serve during lunch?
2. What is your busiest 30–60 minute period?
3. What is the approximate average bill value?
4. What are your top ten selling items?
5. How long does a typical order take to prepare?
6. How many orders can you prepare every ten minutes without disrupting walk-in customers?
7. How do you currently handle unavailable items and customer cancellations?
8. Can one staff member monitor a tablet during peak hours?
9. Does the vendor understand that the customer pays the additional 7% QuickPick fee and the vendor is not additionally charged another 7% commission?
10. What concerns would prevent the shop from continuing after a pilot?

---

## 18. Student Validation and Launch Plan

### Before launch

- Interview 50–100 students across years/departments/hostels.
- Ask how often they visit Java during lunch, how long they wait, whether they would pre-order and whether they would pay the disclosed convenience premium.
- Do not rely on “Would you use this?” alone. Use a clickable prototype and ask students to complete a realistic checkout flow.
- Ask what pickup arrangement would make the service worthwhile.
- Record objections to the 7% price increase.

### Pilot launch

- Start with two participating shops (or three if a third signs up).
- Start during lunch only.
- Limit pickup slots according to each shop's real capacity.
- Invite a controlled group of 50–100 students.
- Keep support available during the lunch period.
- Review order issues and vendor workload daily.
- Expand only after reliability, repeat usage and contribution economics are demonstrated.

### Key metrics

**Acquisition/conversion**
- QR visits/app sessions.
- Shop/menu views.
- Add-to-cart rate.
- Checkout initiation rate.
- Successful payment rate.
- Checkout abandonment and stated reason.

**Operations**
- Orders received per shop per lunch.
- Vendor acceptance time.
- Prep time.
- Ready within promised pickup window.
- Time from Ready to Collected.
- Rejections, cancellations, refunds and no-shows.
- Tablet uptime and notification delivery.

**Retention/value**
- Repeat purchase rate.
- Orders per active student.
- Student satisfaction.
- Actual wait-time reduction vs baseline.
- Vendor willingness to continue.
- Incremental orders vendors believe came through QuickPick.

**Unit economics**
- Average food order value.
- Gross convenience fee.
- Applicable GST on platform service.
- Provider collection/split costs.
- Refund/chargeback cost.
- Variable cost per order.
- Contribution per completed order.
- Tablet payback period.

---

## 19. Proposed Delivery Roadmap

This is a planning sequence, not a promise that legal/provider/university approvals will complete within these timeframes.

### Phase 0 — Confirm the operating model

- Get written confirmation from two vendors.
- Obtain vendor menus and operating data.
- Observe lunch queues and service times.
- Get SRM/food-court permission process clarified.
- Get CA/FSSAI advice on legal/tax structure.
- Request marketplace quotations/onboarding requirements from Cashfree and Razorpay.
- Finalise fee disclosure and vendor agreement wording.

### Phase 1 — Build local/sandbox MVP

- Set up repository and architecture.
- Build authentication and roles.
- Build shop/menu management.
- Build student browse/cart/quote/checkout (mock payments).
- Build vendor tablet order dashboard.
- Build order state machine and pickup-slot capacity.
- Build admin dashboard.
- Build payment provider abstraction and test adapter.
- Build simulated webhook and refund flows.
- Add tests and documentation.

### Phase 2 — QA and pilot preparation

- Test at least 100 simulated orders.
- Test simultaneous slot reservations.
- Test duplicate/late/out-of-order webhooks.
- Test payment failures, vendor rejection and refunds.
- Test tablet Wi-Fi interruption and recovery.
- Test vendor isolation/security.
- Train vendors and hand over tablets only after agreements.

### Phase 3 — Approved controlled pilot

- Enable real payment only after provider approval and compliance gates.
- Start with two shops.
- Run lunch-only.
- Limit orders per slot.
- Monitor every order during early days.
- Review metrics daily.

### Phase 4 — Expand

- Add shops gradually (2 → 3/5 → 10 → 20).
- Add tablets only as shops are signed and volume supports it.
- Improve reporting and vendor settlement statements.
- Consider printers or new payment/notification capabilities only when justified by real use.

---

## 20. Initial Acceptance Criteria

The MVP is not complete merely because pages render. It must satisfy these observable outcomes:

### Student/order

- Student can see only active participating shops.
- Student can view accurate current shop menu/prices.
- Student cannot create a multi-shop order.
- Server recalculates all amounts; client-submitted prices are ignored.
- Student can see the 7% fee and total before payment.
- Student cannot reserve a full pickup slot.
- Student can track their own order but cannot access another student's order.

### Payment

- Sandbox payment success creates exactly one paid order.
- Payment failure does not send a paid order to vendor.
- Duplicate webhook creates no duplicate order/split.
- Forged webhook is rejected.
- Out-of-order webhook is handled safely.
- Refund updates ledger/order state correctly.
- Payment and settlement are separate statuses.
- No secret appears in frontend bundles or repository.

### Vendor

- Vendor sees only its own shop's orders.
- New order generates sound and visible alert while dashboard active.
- Vendor can accept/reject only allowed orders.
- Invalid state transition is rejected server-side.
- Vendor can mark Preparing, Ready and Collected.
- Paused shop receives no new order reservations.
- Dashboard recovers current state after browser reload/network loss.

### Capacity

- Concurrent requests cannot overbook a slot.
- Failed/expired payment releases temporary capacity.
- Duplicate events do not double-release or double-reserve capacity.

### Admin

- Admin can onboard two shops and assign a device to each.
- Admin can inspect order/payment event timeline.
- Admin can export daily operational data.
- Sensitive settings and audit actions are protected.

### Quality

- Build, lint and tests pass.
- No TypeScript errors.
- No obvious accessibility or mobile-layout blockers.
- README includes local setup and environment configuration.
- `.env.example` contains placeholders only.
- Database migrations are repeatable and documented.

---

## 21. Risks and Mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Students reject 7% premium | Low conversion/retention | Test real willingness to pay; transparent pricing; demonstrate time saved |
| Vendors cannot keep up | Digital queue moves to kitchen | Capacity limits, realistic slots, pause orders, measured prep time |
| Vendor does not monitor tablet | Orders missed | Sound/visual alert, training, connectivity/last-seen indicator, backup contact |
| Payment success but order not created | Customer charged without fulfilment | Verified webhooks, idempotency, reconciliation and safe retry workflow |
| Refund delays | Student dissatisfaction | Visible refund status and provider-supported process |
| Regulatory structure misunderstood | Legal/tax exposure | CA/FSSAI/provider review before live transactions |
| Campus permission not obtained | Pilot blocked | Engage food-court/campus authority before placing devices or marketing |
| Tablet damage/loss | Upfront capital loss | Loan agreement, asset register, cases, limited phased deployment |
| Menu prices inaccurate | Disputes and refunds | Vendor approval, price snapshot and audit history |
| Wi-Fi interruption | Missed orders | Reconnect, database refresh, polling fallback and clear offline state |
| Only two shops participate | Limited choice/volume | Prove the model with two; onboard gradually |
| Platform fee misunderstood | Vendor/student trust damage | Explicit fee breakdown and written vendor agreement |

---

## 22. Brand and Experience Direction

**Working name:** Java QuickPick  
**Tagline:** Order ahead. Pick up on time.  
**Tone:** Fast, clear, trustworthy, campus-friendly.  
**Visual direction:** Clean modern food-ordering interface; easy-to-read cards; strong status colours; large touch targets for tablet use.  
**Primary UX priority:** A student should be able to find a shop, choose food and understand the final price without confusion. A vendor should be able to respond to a new order in one or two taps.

Do not use SRM's official logo or imply university endorsement unless written authorisation is obtained. Java QuickPick is a working brand name; verify name/trademark/domain availability before formal company branding.

---

# 23. Claude Code — Master Build Prompt

Copy the entire prompt below into Claude Code at the root of the Java QuickPick repository. Keep this Markdown file in the repository (for example, `docs/JAVA_QUICKPICK_PROJECT_BRIEF.md`) and instruct Claude to read it first.

```text
You are the lead product engineer, staff-level full-stack architect, security reviewer and implementation owner for Java QuickPick.

Your task is to START BUILDING the actual Java QuickPick application, not merely provide advice or a high-level plan.

SOURCE OF TRUTH
1. First read the complete file `docs/JAVA_QUICKPICK_PROJECT_BRIEF.md` (or the exact path where this brief has been saved).
2. Treat that document as the product and business source of truth.
3. The core product is a campus food pre-order and scheduled-pickup platform for independent shops at the Java food court, SRM KTR.
4. Two vendors have verbally agreed; two more are considering. Start with support for two pilot shops, but architect for approximately 20.
5. Students pay online. The intended commercial model is a 7% customer-paid QuickPick convenience fee on the eligible food subtotal. The vendor's commercial entitlement is the original agreed menu price. There is NO second 7% commission deducted from the vendor.
6. Exact GST, FSSAI, invoicing, fund-flow and marketplace payment treatment has not been professionally approved. Do not hard-code tax assumptions or enable real payments. Implement a sandbox/mock payment adapter and a provider-neutral architecture first.
7. QuickPick plans to loan dedicated Android tablets to vendors. The tablets remain QuickPick property.
8. The MVP is pickup only, lunch-first and single-shop-per-order. No delivery, multi-shop cart, wallet, loyalty programme or AI features in the first version.

WORKING METHOD
- Inspect the existing repository before making changes. Identify its framework, package manager, current features, code style, environment and test setup.
- Do not overwrite working functionality or replace an existing architecture without a clear reason.
- If the repository is empty, scaffold a maintainable TypeScript monorepo using React + Vite for student/vendor/admin frontends, Node.js + Express for the API, PostgreSQL and one ORM/migration tool.
- If the repository already contains a suitable stack, adapt to it rather than needlessly rewriting it.
- Start by writing a concise implementation plan and repository assessment in `docs/IMPLEMENTATION_PLAN.md`, then proceed to implement the MVP in small working increments. Do not stop after writing the plan.
- Do not ask the user questions for decisions that can safely be represented as configuration or mock behaviour. If a truly blocking external credential/approval is missing, build the interface and adapter with a mock implementation, document the exact integration point, and continue.
- Never invent production credentials, provider approvals, FSSAI licence details, GST rates, campus permissions, vendor bank accounts or live business data.
- Never claim a feature is complete unless it is implemented and tested.

PRODUCT SCOPE TO IMPLEMENT
A. STUDENT PWA
- Mobile-first Java QuickPick landing page.
- Show active participating shops and shop open/paused state.
- Shop details and menu categories/items.
- Menu item name, description, image placeholder, base shop price and availability.
- Cart restricted to ONE shop per order. If a student tries to add an item from another shop, clearly require clearing/switching the cart.
- Quantity updates and item removal.
- Pickup slot selection using server-provided availability.
- Server-generated order quote.
- Transparent price breakdown: food subtotal, QuickPick fee at configurable 7%, approved configurable tax/other charge lines, total payable.
- Do not silently add charges at final checkout. Do not hard-code a GST rate.
- Sandbox checkout only. Show test-payment state clearly in development.
- Order confirmation, order number, status tracker, pickup code/QR placeholder and order history.
- Useful empty, loading, error, out-of-stock and shop-paused states.

B. VENDOR TABLET PWA
- Tablet-first responsive dashboard, usable in portrait and landscape.
- Login restricted to the vendor's assigned shop(s).
- Clear Online/Offline/Paused connection and shop indicators.
- Large new-order cards and visible/audible notification.
- New, Accepted, Preparing and Ready views/counts.
- Show order ID, item names, quantities, relevant notes, paid status, pickup window and order totals.
- Accept or reject with reason.
- Set/update preparation estimate if feasible.
- Mark Preparing, Ready and Collected using validated transitions.
- Toggle menu availability and pause/resume new QuickPick orders.
- Recover active orders after reload/reconnect by fetching from the API; do not rely only on WebSocket events.
- Do not show another shop's data.

C. ADMIN DASHBOARD
- Admin login/role protection.
- Create/edit/activate/suspend shops.
- Create/invite vendor users and assign shop-scoped roles.
- Manage categories and menu items.
- Manage pickup slot durations/capacities and shop hours.
- View platform orders, statuses and events.
- View mock payment records, refund records and fee calculations.
- Register/assign tablets and show device last-seen/status.
- Manage configurable fee policy (default 7%) with effective date/version. Changes must not alter old orders.
- Basic daily metrics: orders, food GMV, gross QuickPick fees, cancelled/refunded orders, active shops.
- CSV export if time permits.

D. ORDER AND PAYMENT DOMAIN
- Separate order status from payment status.
- Implement valid state transitions and append-only order events.
- Suggested order statuses: PENDING_PAYMENT, AWAITING_VENDOR, ACCEPTED, PREPARING, READY, COLLECTED, REJECTED, CANCELLED, EXPIRED, NOT_COLLECTED.
- Suggested payment statuses: NOT_STARTED, INITIATED, PENDING, SUCCEEDED, FAILED, REFUND_PENDING, PARTIALLY_REFUNDED, REFUNDED, DISPUTED.
- For the development adapter, create a test payment flow that can simulate success, failure and refund without taking real money.
- Do not mark an order paid based on a client redirect. Simulate a signed webhook and build the production webhook verification interface.
- Make order creation, payment events, webhook processing and refunds idempotent.
- Use a unique external event ID for webhook deduplication.
- Keep payment settlement separate from payment success.
- Implement a provider-neutral interface for checkout, verification, refunds, vendor onboarding, split/transfer and settlement reporting. Add Cashfree/Razorpay adapters only after actual provider credentials and approved commercial terms are supplied. Do not guess API schemas; use official documentation at that time.

E. PICKUP SLOT CAPACITY
- Each shop has configurable operating windows, slot duration and maximum orders per slot.
- Reserve a slot temporarily during checkout and release it on failure/expiry.
- Confirm it only after verified test-payment success.
- Use a database transaction/locking or another concurrency-safe method so simultaneous requests cannot overbook the last place.
- Handle duplicate webhooks and expiry jobs without double-incrementing or double-decrementing capacity.
- Support shop pause/busy mode.

F. DATABASE AND SECURITY
- Use PostgreSQL and migrations.
- Store money as integer paise, never floating-point rupees.
- Snapshot item names/prices, base subtotal, fee rate, fee amount, tax/charge lines and total on each order.
- Suggested entities include users, shops, shop_members, categories, menu_items, devices, pickup_slots, orders, order_items, order_events, payments, payment_splits, refunds, settlements, settlement_reconciliation, webhook_events, pricing_policies, complaints and audit_logs. Refine as needed but preserve the required capabilities.
- Enforce role-based access on the server for every protected endpoint.
- Enforce shop/tenant isolation in vendor APIs and test it.
- Validate payloads on the server (Zod or existing equivalent).
- Use environment variables for secrets. Add `.env.example` with placeholder values only.
- No secrets, provider credentials, OTPs, card data or UPI PINs in source control or logs.
- Add rate limiting to sensitive endpoints and secure authentication/session handling.
- Add audit records for admin and financial changes.
- Use HTTPS assumptions in deployment documentation.

G. DOCUMENTATION AND OPERATIONS
- Keep README setup instructions current.
- Document local development, database setup/migrations, seeded demo data, test accounts and how to run tests.
- Add architecture, data model and API contract docs under `docs/`.
- Add a tablet setup/runbook including kiosk/full-screen recommendations, sound permissions, reconnect/recovery and what vendors do if Wi-Fi fails.
- Add `.env.example`; never include actual credentials.
- Add a clear warning that the app is in sandbox mode and real payments are disabled pending FSSAI/GST/CA, provider and SRM approvals.

DESIGN EXPECTATIONS
- Use a polished, simple, modern campus-food ordering design.
- Mobile UI should be fast and uncluttered.
- Vendor interface must prioritise large touch targets, high-contrast order states and fast one/two-tap actions.
- Use consistent components, responsive layouts, meaningful loading/empty/error states and accessible labels.
- Do not use fake reviews, fake customer counts, fake live order counts or invented vendor data in production screens. Seed data must be clearly marked as demo.
- Do not imply official SRM endorsement or use university logos without permission. Use “Java QuickPick” as a working brand.

TESTING REQUIREMENTS
Write and run tests for at least:
1. Fee calculation at 7% with paise rounding rules.
2. Historical order price snapshot remains unchanged after menu price or fee-policy update.
3. Cart cannot contain items from multiple shops.
4. Student cannot view another student's order.
5. Vendor A cannot view or update Vendor B's orders.
6. Invalid order state transitions are rejected.
7. Payment failure does not notify vendor of a paid order.
8. Successful sandbox webhook changes payment/order state exactly once.
9. Duplicate webhook is idempotent.
10. Invalid webhook signature is rejected by the provider interface/test implementation.
11. Refund updates the correct ledger entries and status.
12. Concurrent pickup-slot booking cannot exceed capacity.
13. Failed/expired checkout releases reserved capacity exactly once.
14. Vendor dashboard reload/reconnect fetches current active orders.
15. Admin-only routes reject vendor/student roles.

DEFINITION OF DONE FOR THE FIRST BUILD
- A new developer can clone/install, configure local env, migrate and seed the database, then run the complete project using documented commands.
- Student can browse demo shops, add products, see a transparent price quote, choose a slot and complete a simulated successful or failed payment.
- Vendor tablet view receives the paid demo order and can accept, prepare, mark ready and mark collected.
- Admin can create shops/menu items and inspect orders/payments.
- Slot capacity is enforced.
- Financial amounts are stored in paise and shown consistently.
- Role isolation and core payment/order tests pass.
- Build, lint and test commands pass. Fix failures; do not merely report them.
- No live payment collection is enabled.

EXECUTION INSTRUCTIONS
1. Inspect the repository and report the existing stack and any relevant files.
2. Create/update `docs/IMPLEMENTATION_PLAN.md` with phases and the first implementation slice.
3. Implement a working vertical slice first: seed shop/menu → student browse → cart → quote → sandbox payment success → vendor receives order → vendor marks Ready/Collected → student sees status.
4. Then implement admin onboarding, slot capacity, refunds, reconciliation and remaining UI.
5. Run tests and lint/build after each meaningful milestone.
6. At the end, report exactly what is implemented, commands run, tests passed/failed, any known gaps and the next concrete tasks.
7. If the work is too large for one context window, leave the repository in a working state, update `docs/PROGRESS.md` with completed/incomplete items and exact next steps, and continue from that file in the next session. Do not discard work or generate a generic plan instead of implementation.

Start now. Inspect the repository and begin implementing the first working vertical slice.
```

---

## 24. How to Use This Document with Claude Code

1. Create or open the Java QuickPick repository.
2. Save this file in the repository as `docs/JAVA_QUICKPICK_PROJECT_BRIEF.md` (create the `docs` directory if needed).
3. Open Claude Code from the repository root.
4. Paste the complete **Master Build Prompt** in Section 23.
5. Let Claude inspect the repository and begin the vertical slice.
6. Review all diffs before accepting changes. Do not paste real gateway secrets into chat or source files.
7. Ask Claude to run the project locally and demonstrate the full simulated order lifecycle before moving to production provider integration.

### Suggested first acceptance demonstration

A student opens the PWA, selects Demo Shop A, adds a ₹100 demo item, sees the configured 7% QuickPick fee and total, selects an available pickup slot, completes a simulated payment, and receives an order number. The assigned vendor tablet dashboard receives the order, plays a notification, and allows the vendor to accept it, mark it Preparing, mark it Ready and mark it Collected. The student's screen updates at each step. The admin dashboard shows the order, payment event and fee breakdown. All of this must work with seeded demo data and no real money.

---

## 25. Open Decisions Register

Do not silently make these decisions. Build configuration or mock behaviour until the founder confirms them.

| Decision | Current status | Required next action |
|---|---|---|
| Exact legal entity/ownership | Not decided | Founder/legal advice |
| Written vendor agreements | Verbal interest only | Get two signatures/confirmations |
| Third vendor | Pending | Follow up with two considering shops |
| Shop daily orders/AOV | Unknown | Collect 7-day approximate operating data |
| Student willingness to pay 7% | Not validated | Survey/prototype checkout test |
| Exact fee tax treatment | Not approved | CA written opinion |
| Restaurant-service GST/invoice flow | Not approved | CA written opinion under applicable rules |
| FSSAI e-commerce licence | Not confirmed | Confirm with FoSCoS/FSSAI professional |
| Payment provider | Not selected | Obtain approval/quotes from Cashfree and Razorpay |
| Vendor-linked account/settlement | Not configured | Provider onboarding |
| Campus permission | Not confirmed | Speak to food-court management and SRM authority |
| Student identity verification | Not decided | Test practical options; don't assume SRM SSO |
| Tablet model/supplier | Not selected | Obtain current quotations and test vendor UI |
| Pickup counter/shelf | Not agreed | Discuss with shops/campus management |
| Slot capacity per shop | Unknown | Measure preparation throughput |
| Customer cancellation/no-show policy | Not final | Draft, vendor review and legal review |
| Operating days/hours | Lunch-first intention | Confirm with shops |

---

## 26. The Core Principle

Java QuickPick succeeds only if all three parties benefit:

- **Students** willingly pay the disclosed convenience premium because QuickPick saves meaningful time and offers a reliable pickup experience.
- **Vendors** receive the agreed original food-price entitlement, manageable additional digital orders and a simple system that does not disrupt walk-in operations.
- **QuickPick** retains a sustainable net fee after applicable taxes, payment costs, refunds, hardware and operations.

The immediate objective is not to build every feature or onboard all 20 shops. It is to deliver a reliable, compliant, measurable two-shop pilot and prove that students reorder.
