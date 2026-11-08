import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expireStaleOrders } from '../src/services/orders.js';
import { makeEnv, type Env } from './helpers.js';

let e: Env;
let vendorA: string;
let vendorB: string;
let admin: string;
let superAdmin: string;

beforeAll(async () => {
  e = await makeEnv();
  vendorA = await e.staffToken('vendor-a@quickpick.demo');
  vendorB = await e.staffToken('vendor-b@quickpick.demo');
  admin = await e.staffToken('admin@quickpick.demo');
  superAdmin = await e.staffToken('super@quickpick.demo');
}, 60_000);

afterAll(async () => {
  await e.close();
});

const vendorOrders = async (token: string) => (await e.api.get('/api/v1/vendor/orders').set(e.auth(token))).body.orders as any[];

describe('1. fee calculation at 7% (server quote, paise)', () => {
  it('quotes ₹100 as ₹7 fee / ₹107 total, ignoring any client-sent price', async () => {
    const s = await e.studentToken('quote1@srm.test');
    const m = await e.menu(e.shopA.id);
    const slot = await e.nextSlot(e.shopA.id);
    const res = await e.api
      .post('/api/v1/orders/quote')
      .set(e.auth(s))
      .send({ shopId: e.shopA.id, slotId: slot.id, items: [{ menuItemId: m['Demo Veg Meal'].id, quantity: 1, unitPricePaise: 1 }], totalPaise: 1 });
    expect(res.status).toBe(200);
    expect(res.body.breakdown).toMatchObject({ subtotalPaise: 10000, feeRateBps: 700, feePaise: 700, taxPaise: 0, totalPaise: 10700 });
    expect(res.body.policyApproved).toBe(false); // sandbox policy is flagged unapproved
  });
});

describe('2. historical order snapshot survives menu and fee-policy changes', () => {
  it('keeps old order amounts after a price edit and a new 10% policy', async () => {
    const s = await e.studentToken('snap@srm.test');
    const { orderId } = await e.placePaidOrder(s, e.shopA.id, 'Demo Paneer Rice Bowl');
    const before = (await e.api.get(`/api/v1/orders/${orderId}`).set(e.auth(s))).body.order;
    expect(before).toMatchObject({ subtotalPaise: 14000, feePaise: 980, totalPaise: 14980 });

    const m = await e.menu(e.shopA.id);
    const edit = await e.api.patch(`/api/v1/admin/menu-items/${m['Demo Paneer Rice Bowl'].id}`).set(e.auth(admin)).send({ basePricePaise: 20000 });
    expect(edit.status).toBe(200);
    const pol = await e.api.patch('/api/v1/admin/pricing-policy').set(e.auth(superAdmin)).send({ feeRateBps: 1000, note: 'test' });
    expect(pol.status).toBe(201);

    const after = (await e.api.get(`/api/v1/orders/${orderId}`).set(e.auth(s))).body.order;
    expect(after).toMatchObject({ subtotalPaise: 14000, feeRateBps: 700, feePaise: 980, totalPaise: 14980 });
    expect(after.items[0]).toMatchObject({ name: 'Demo Paneer Rice Bowl', unitPricePaise: 14000 });

    // A NEW quote uses the new price and the new fee policy.
    const slot = await e.nextSlot(e.shopA.id);
    const q = await e.api.post('/api/v1/orders/quote').set(e.auth(s)).send({ shopId: e.shopA.id, slotId: slot.id, items: [{ menuItemId: m['Demo Paneer Rice Bowl'].id, quantity: 1 }] });
    expect(q.body.breakdown).toMatchObject({ subtotalPaise: 20000, feeRateBps: 1000, feePaise: 2000 });

    // restore for later tests
    await e.api.patch(`/api/v1/admin/menu-items/${m['Demo Paneer Rice Bowl'].id}`).set(e.auth(admin)).send({ basePricePaise: 14000 });
    await e.api.patch('/api/v1/admin/pricing-policy').set(e.auth(superAdmin)).send({ feeRateBps: 700, note: 'restore 7%' });
  });
});

describe('3. one shop per order', () => {
  it('rejects a cart mixing items from two shops', async () => {
    const s = await e.studentToken('multi@srm.test');
    const a = await e.menu(e.shopA.id);
    const b = await e.menu(e.shopB.id);
    const slot = await e.nextSlot(e.shopA.id);
    const res = await e.createOrder(s, e.shopA.id, slot.id, [
      { menuItemId: a['Demo Veg Meal'].id, quantity: 1 },
      { menuItemId: b['Demo Masala Dosa'].id, quantity: 1 },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MULTI_SHOP_CART');
  });
});

describe('4. students cannot see each other’s orders', () => {
  it('returns 404 for another student’s order and lists only own orders', async () => {
    const s1 = await e.studentToken('own1@srm.test');
    const s2 = await e.studentToken('own2@srm.test');
    const { orderId } = await e.placePaidOrder(s1, e.shopA.id);
    expect((await e.api.get(`/api/v1/orders/${orderId}`).set(e.auth(s1))).status).toBe(200);
    expect((await e.api.get(`/api/v1/orders/${orderId}`).set(e.auth(s2))).status).toBe(404);
    expect((await e.api.post(`/api/v1/orders/${orderId}/cancel`).set(e.auth(s2))).status).toBe(404);
    const mine = (await e.api.get('/api/v1/me/orders').set(e.auth(s2))).body.orders;
    expect(mine.find((o: any) => o.id === orderId)).toBeUndefined();
  });
});

describe('5. vendor tenant isolation', () => {
  it('vendor A cannot list, read or change vendor B’s orders, and vendors never see student contact data', async () => {
    const s = await e.studentToken('iso@srm.test');
    const { orderId } = await e.placePaidOrder(s, e.shopB.id, 'Demo Masala Dosa');
    expect((await vendorOrders(vendorB)).some((o) => o.id === orderId)).toBe(true);
    expect((await vendorOrders(vendorA)).some((o) => o.id === orderId)).toBe(false);

    expect((await e.api.post(`/api/v1/vendor/orders/${orderId}/accept`).set(e.auth(vendorA))).status).toBe(404);
    expect((await e.api.post(`/api/v1/vendor/orders/${orderId}/reject`).set(e.auth(vendorA)).send({ reason: 'x' })).status).toBe(404);
    expect((await e.api.patch(`/api/v1/vendor/orders/${orderId}/status`).set(e.auth(vendorA)).send({ status: 'PREPARING' })).status).toBe(404);
    // Cannot act as another shop via header or touch its menu.
    expect((await e.api.get('/api/v1/vendor/orders').set(e.auth(vendorA)).set('x-shop-id', e.shopB.id)).status).toBe(403);
    const bMenu = await e.menu(e.shopB.id);
    expect((await e.api.patch(`/api/v1/vendor/menu-items/${bMenu['Demo Masala Dosa'].id}`).set(e.auth(vendorA)).send({ available: false })).status).toBe(404);
    expect((await e.api.patch('/api/v1/vendor/shop/status').set(e.auth(vendorA)).set('x-shop-id', e.shopB.id).send({ acceptingOrders: false })).status).toBe(403);

    // The real owner still can, and the payload carries a first name only (no email/phone/pickup code).
    const own = (await vendorOrders(vendorB)).find((o) => o.id === orderId);
    expect(own.customerName).toBe('iso');
    expect(JSON.stringify(own)).not.toContain('@srm.test');
    expect(own.pickupCode).toBeUndefined();
    expect((await e.api.post(`/api/v1/vendor/orders/${orderId}/accept`).set(e.auth(vendorB))).status).toBe(200);
  });
});

describe('6. order state machine is enforced server-side', () => {
  it('rejects skips and moves out of terminal states; records every transition', async () => {
    const s = await e.studentToken('sm@srm.test');
    const { orderId, order } = await e.placePaidOrder(s, e.shopA.id);
    const patch = (status: string, extra: object = {}) => e.api.patch(`/api/v1/vendor/orders/${orderId}/status`).set(e.auth(vendorA)).send({ status, ...extra });

    expect((await patch('READY')).status).toBe(409); // AWAITING_VENDOR -> READY not allowed
    expect((await patch('PREPARING')).status).toBe(409); // must accept first
    expect((await e.api.post(`/api/v1/vendor/orders/${orderId}/accept`).set(e.auth(vendorA)).send({ prepMinutes: 8 })).status).toBe(200);
    expect((await e.api.post(`/api/v1/vendor/orders/${orderId}/accept`).set(e.auth(vendorA))).status).toBe(409); // double accept
    expect((await e.api.post(`/api/v1/vendor/orders/${orderId}/reject`).set(e.auth(vendorA)).send({ reason: 'late' })).status).toBe(409); // cannot reject after accept
    expect((await patch('COLLECTED', { pickupCode: order.pickupCode })).status).toBe(409); // not READY yet
    expect((await patch('PREPARING')).status).toBe(200);
    expect((await patch('READY')).status).toBe(200);
    expect((await patch('COLLECTED', { pickupCode: '0000' })).status).toBe(422); // wrong code
    expect((await patch('COLLECTED', { pickupCode: order.pickupCode })).status).toBe(200);
    expect((await patch('PREPARING')).status).toBe(409); // terminal
    expect((await e.api.post(`/api/v1/orders/${orderId}/cancel`).set(e.auth(s))).status).toBe(409);

    const events = (await e.api.get(`/api/v1/admin/orders/${orderId}`).set(e.auth(admin))).body.events.map((x: any) => x.to);
    expect(events).toEqual(['PENDING_PAYMENT', 'AWAITING_VENDOR', 'ACCEPTED', 'PREPARING', 'READY', 'COLLECTED']);
  });
});

describe('7. payment failure never reaches the vendor', () => {
  it('cancels the unpaid order, releases the slot and emits no vendor notification', async () => {
    const s = await e.studentToken('fail@srm.test');
    const m = await e.menu(e.shopA.id);
    const slot = await e.nextSlot(e.shopA.id);
    const before = await e.reserved(slot.id);
    const created = await e.createOrder(s, e.shopA.id, slot.id, [{ menuItemId: m['Demo Masala Chai'].id, quantity: 2 }]);
    const orderId = created.body.order.id;
    expect(await e.reserved(slot.id)).toBe(before + 1);
    await e.startCheckout(s, orderId);
    const mark = e.notifications.length;
    const res = await e.simulate(s, orderId, 'failure');
    expect(res.body.order).toMatchObject({ status: 'CANCELLED', paymentStatus: 'FAILED' });
    expect(await e.reserved(slot.id)).toBe(before);
    expect(e.notifications.slice(mark).filter((n) => n.orderId === orderId && n.notifyVendor)).toHaveLength(0);
    expect((await vendorOrders(vendorA)).some((o) => o.id === orderId)).toBe(false);
  });
});

describe('8–9. webhook success applies exactly once; duplicates are idempotent', () => {
  it('processes the first delivery, ignores the duplicate, and ignores a re-sent success under a new event id', async () => {
    const s = await e.studentToken('hook@srm.test');
    const m = await e.menu(e.shopA.id);
    const slot = await e.nextSlot(e.shopA.id);
    const orderId = (await e.createOrder(s, e.shopA.id, slot.id, [{ menuItemId: m['Demo Veg Meal'].id, quantity: 1 }])).body.order.id;
    const { providerRef } = (await e.startCheckout(s, orderId)).body;
    const signed = e.ctx.provider.name === 'mock' ? (e.ctx.provider as any).buildSignedEvent({ id: 'evt_dup_1', type: 'payment.succeeded', providerRef, amountPaise: 10700 }) : null;
    const mark = e.notifications.length;

    const post = (sg: any) => e.api.post('/api/v1/webhooks/payments/mock').set(sg.headers).set('Content-Type', 'application/json').send(sg.body.toString());
    const first = await post(signed);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'processed', result: 'payment_succeeded' });
    const dup = await post(signed);
    expect(dup.status).toBe(200);
    expect(dup.body.status).toBe('duplicate');
    const resend = await post((e.ctx.provider as any).buildSignedEvent({ id: 'evt_dup_2', type: 'payment.succeeded', providerRef, amountPaise: 10700 }));
    expect(resend.body.result).toBe('noop_already_succeeded');

    const o = (await e.api.get(`/api/v1/admin/orders/${orderId}`).set(e.auth(admin))).body;
    expect(o.order).toMatchObject({ status: 'AWAITING_VENDOR', paymentStatus: 'SUCCEEDED' });
    expect(o.payments).toHaveLength(1);
    expect(o.events.filter((x: any) => x.to === 'AWAITING_VENDOR')).toHaveLength(1);
    expect(o.splits.map((x: any) => `${x.beneficiary}:${x.amountPaise}`).sort()).toEqual(['PLATFORM:700', 'VENDOR:10000']);
    expect(e.notifications.slice(mark).filter((n) => n.orderId === orderId && n.notifyVendor && n.kind === 'NEW_ORDER')).toHaveLength(1);
    expect(Number((await e.db.query(`SELECT COUNT(*)::bigint AS c FROM webhook_events WHERE external_event_id='evt_dup_1'`))[0].c)).toBe(1);
    // Slot still reserved exactly once.
    expect(await e.reserved(slot.id)).toBeGreaterThanOrEqual(1);
  });

  it('ignores a success event whose amount does not match what was expected', async () => {
    const s = await e.studentToken('amount@srm.test');
    const m = await e.menu(e.shopA.id);
    const slot = await e.nextSlot(e.shopA.id);
    const orderId = (await e.createOrder(s, e.shopA.id, slot.id, [{ menuItemId: m['Demo Veg Meal'].id, quantity: 1 }])).body.order.id;
    const { providerRef } = (await e.startCheckout(s, orderId)).body;
    const sg = (e.ctx.provider as any).buildSignedEvent({ id: 'evt_amt_1', type: 'payment.succeeded', providerRef, amountPaise: 1 });
    const r = await e.api.post('/api/v1/webhooks/payments/mock').set(sg.headers).set('Content-Type', 'application/json').send(sg.body.toString());
    expect(r.body.result).toBe('amount_mismatch_ignored');
    expect((await e.api.get(`/api/v1/orders/${orderId}`).set(e.auth(s))).body.order.status).toBe('PENDING_PAYMENT');
  });
});

describe('10. forged webhooks are rejected', () => {
  it('rejects a bad signature, a missing signature and a tampered body, and stores nothing', async () => {
    const s = await e.studentToken('forge@srm.test');
    const m = await e.menu(e.shopA.id);
    const slot = await e.nextSlot(e.shopA.id);
    const orderId = (await e.createOrder(s, e.shopA.id, slot.id, [{ menuItemId: m['Demo Veg Meal'].id, quantity: 1 }])).body.order.id;
    const { providerRef } = (await e.startCheckout(s, orderId)).body;
    const good = (e.ctx.provider as any).buildSignedEvent({ id: 'evt_forge_1', type: 'payment.succeeded', providerRef, amountPaise: 10700 });
    const send = (headers: Record<string, string>, body: Buffer) => e.api.post('/api/v1/webhooks/payments/mock').set(headers).set('Content-Type', 'application/json').send(body.toString());

    expect((await send({ 'x-mock-signature': 'a'.repeat(64) }, good.body)).status).toBe(401);
    expect((await send({}, good.body)).status).toBe(401);
    const tampered = Buffer.from(good.body.toString().replace('10700', '1'));
    expect((await send(good.headers, tampered)).status).toBe(401);
    expect((await e.api.post('/api/v1/webhooks/payments/razorpay').send({})).status).toBe(404);

    expect(Number((await e.db.query(`SELECT COUNT(*)::bigint AS c FROM webhook_events WHERE external_event_id='evt_forge_1'`))[0].c)).toBe(0);
    expect((await e.api.get(`/api/v1/orders/${orderId}`).set(e.auth(s))).body.order.paymentStatus).toBe('INITIATED');
    // The genuine one still works afterwards.
    expect((await send(good.headers, good.body)).body.result).toBe('payment_succeeded');
  });

  it('never trusts a browser/client claim of payment: no student route marks an order paid without a signed webhook', async () => {
    const s = await e.studentToken('redirect@srm.test');
    const m = await e.menu(e.shopA.id);
    const slot = await e.nextSlot(e.shopA.id);
    const orderId = (await e.createOrder(s, e.shopA.id, slot.id, [{ menuItemId: m['Demo Veg Meal'].id, quantity: 1 }])).body.order.id;
    await e.startCheckout(s, orderId);
    const r = await e.api.get(`/api/v1/orders/${orderId}?paid=true&status=SUCCESS`).set(e.auth(s));
    expect(r.body.order.paymentStatus).toBe('INITIATED');
    expect(r.body.order.status).toBe('PENDING_PAYMENT');
  });
});

describe('11. refunds update the ledger', () => {
  it('vendor rejection auto-refunds in full, reverses splits and releases the slot', async () => {
    const s = await e.studentToken('rej@srm.test');
    const { orderId, slotId } = await e.placePaidOrder(s, e.shopA.id);
    const held = await e.reserved(slotId);
    const res = await e.api.post(`/api/v1/vendor/orders/${orderId}/reject`).set(e.auth(vendorA)).send({ reason: 'Out of stock' });
    expect(res.status).toBe(200);
    const o = (await e.api.get(`/api/v1/admin/orders/${orderId}`).set(e.auth(admin))).body;
    expect(o.order).toMatchObject({ status: 'REJECTED', paymentStatus: 'REFUNDED' });
    expect(o.refunds).toHaveLength(1);
    expect(o.refunds[0]).toMatchObject({ amountPaise: 10700, status: 'PROCESSED' });
    expect(o.splits.every((x: any) => x.status === 'REVERSED')).toBe(true);
    expect(await e.reserved(slotId)).toBe(held - 1);
    // Student sees the refund status.
    const mine = (await e.api.get(`/api/v1/orders/${orderId}`).set(e.auth(s))).body;
    expect(mine.refunds[0]).toMatchObject({ amountPaise: 10700, status: 'PROCESSED' });
  });

  it('admin partial refunds recompute status; over-refund and double-submit are blocked', async () => {
    const s = await e.studentToken('partial@srm.test');
    const { orderId } = await e.placePaidOrder(s, e.shopA.id);
    const refund = (amountPaise: number, key: string) => e.api.post('/api/v1/admin/refunds').set(e.auth(admin)).set('Idempotency-Key', key).send({ orderId, amountPaise, reason: 'Goodwill' });

    expect((await refund(2000, 'k-partial-1')).status).toBe(201);
    expect((await e.api.get(`/api/v1/orders/${orderId}`).set(e.auth(s))).body.order.paymentStatus).toBe('PARTIALLY_REFUNDED');
    expect((await refund(2000, 'k-partial-1')).status).toBe(201); // same key: no second refund
    expect((await e.api.get(`/api/v1/admin/orders/${orderId}`).set(e.auth(admin))).body.refunds).toHaveLength(1);
    expect((await refund(9999, 'k-partial-2')).status).toBe(422); // exceeds remaining 8700
    expect((await refund(8700, 'k-partial-3')).status).toBe(201);
    expect((await e.api.get(`/api/v1/orders/${orderId}`).set(e.auth(s))).body.order.paymentStatus).toBe('REFUNDED');
    expect((await e.api.get('/api/v1/admin/reconciliation').set(e.auth(admin))).body.rows.length).toBeGreaterThan(0);
  });
});

describe('12. concurrent pickup-slot booking cannot overbook', () => {
  it('lets exactly `capacity` of 10 simultaneous students reserve the slot', async () => {
    const slot = await e.nextSlot(e.shopB.id);
    await e.db.query(`UPDATE pickup_slots SET capacity=3, reserved_count=0 WHERE id=$1`, [slot.id]);
    const m = await e.menu(e.shopB.id);
    const tokens = await Promise.all(Array.from({ length: 10 }, (_, i) => e.studentToken(`race${i}@srm.test`)));
    const results = await Promise.all(tokens.map((t) => e.createOrder(t, e.shopB.id, slot.id, [{ menuItemId: m['Demo Idli Plate (3)'].id, quantity: 1 }])));
    const ok = results.filter((r) => r.status === 201);
    const full = results.filter((r) => r.status === 409 && r.body.error.code === 'SLOT_FULL');
    expect(ok).toHaveLength(3);
    expect(full).toHaveLength(7);
    expect(await e.reserved(slot.id)).toBe(3);
    const listed = (await e.api.get(`/api/v1/shops/${e.shopB.id}/pickup-slots`)).body.slots.find((x: any) => x.id === slot.id);
    expect(listed).toMatchObject({ remaining: 0, full: true });
  });

  it('is idempotent per Idempotency-Key (a retry does not reserve twice)', async () => {
    const s = await e.studentToken('idem@srm.test');
    const m = await e.menu(e.shopA.id);
    const slot = await e.nextSlot(e.shopA.id);
    const before = await e.reserved(slot.id);
    const body = [{ menuItemId: m['Demo Veg Meal'].id, quantity: 1 }];
    const a = await e.createOrder(s, e.shopA.id, slot.id, body, 'same-key-12345');
    const b = await e.createOrder(s, e.shopA.id, slot.id, body, 'same-key-12345');
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.order.id).toBe(a.body.order.id);
    expect(await e.reserved(slot.id)).toBe(before + 1);
  });

  it('a paused shop accepts no new reservations', async () => {
    const s = await e.studentToken('pause@srm.test');
    const m = await e.menu(e.shopB.id);
    const slot = await e.nextSlot(e.shopB.id);
    expect((await e.api.patch('/api/v1/vendor/shop/status').set(e.auth(vendorB)).send({ acceptingOrders: false })).status).toBe(200);
    const res = await e.createOrder(s, e.shopB.id, slot.id, [{ menuItemId: m['Demo Masala Dosa'].id, quantity: 1 }]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SHOP_PAUSED');
    await e.api.patch('/api/v1/vendor/shop/status').set(e.auth(vendorB)).send({ acceptingOrders: true });
    // Unavailable items are rejected too.
    await e.api.patch(`/api/v1/vendor/menu-items/${m['Demo Masala Dosa'].id}`).set(e.auth(vendorB)).send({ available: false });
    expect((await e.createOrder(s, e.shopB.id, slot.id, [{ menuItemId: m['Demo Masala Dosa'].id, quantity: 1 }])).body.error.code).toBe('ITEM_UNAVAILABLE');
    await e.api.patch(`/api/v1/vendor/menu-items/${m['Demo Masala Dosa'].id}`).set(e.auth(vendorB)).send({ available: true });
  });
});

describe('13. expired / failed checkouts release capacity exactly once', () => {
  it('expires an unpaid checkout, releases once, and a repeat sweep or failure event does not double-release', async () => {
    const slot = await e.nextSlot(e.shopA.id);
    await e.db.query(`UPDATE pickup_slots SET reserved_count=0 WHERE id=$1`, [slot.id]);
    const m = await e.menu(e.shopA.id);
    const s1 = await e.studentToken('exp1@srm.test');
    const s2 = await e.studentToken('exp2@srm.test');
    const o1 = (await e.createOrder(s1, e.shopA.id, slot.id, [{ menuItemId: m['Demo Veg Meal'].id, quantity: 1 }])).body.order.id;
    const o2 = (await e.createOrder(s2, e.shopA.id, slot.id, [{ menuItemId: m['Demo Veg Meal'].id, quantity: 1 }])).body.order.id;
    expect(await e.reserved(slot.id)).toBe(2);
    await e.startCheckout(s1, o1);

    e.clock.t = new Date(e.clock.t.getTime() + 11 * 60_000); // past the 10-minute checkout TTL
    expect(await expireStaleOrders(e.ctx)).toBeGreaterThanOrEqual(2);
    expect(await expireStaleOrders(e.ctx)).toBe(0); // idempotent
    expect(await e.reserved(slot.id)).toBe(0);
    expect((await e.api.get(`/api/v1/orders/${o1}`).set(e.auth(s1))).body.order.status).toBe('EXPIRED');
    expect((await e.api.get(`/api/v1/orders/${o2}`).set(e.auth(s2))).body.order.status).toBe('EXPIRED');

    // A late failure event for an already-expired order must not decrement again.
    await e.simulate(s1, o1, 'failure');
    expect(await e.reserved(slot.id)).toBe(0);
    expect(Number((await e.db.query(`SELECT COUNT(*)::bigint AS c FROM pickup_slots WHERE reserved_count < 0`))[0].c)).toBe(0);
    e.clock.t = new Date(e.clock.t.getTime() - 11 * 60_000);
  });

  it('a late payment success after expiry is refunded automatically and the slot is not re-held', async () => {
    const s = await e.studentToken('late@srm.test');
    const m = await e.menu(e.shopA.id);
    const slot = await e.nextSlot(e.shopA.id);
    await e.db.query(`UPDATE pickup_slots SET reserved_count=0 WHERE id=$1`, [slot.id]);
    const orderId = (await e.createOrder(s, e.shopA.id, slot.id, [{ menuItemId: m['Demo Veg Meal'].id, quantity: 1 }])).body.order.id;
    await e.startCheckout(s, orderId);
    e.clock.t = new Date(e.clock.t.getTime() + 11 * 60_000);
    await expireStaleOrders(e.ctx);
    const res = await e.simulate(s, orderId, 'success');
    expect(res.body.order.status).toBe('EXPIRED');
    const a = (await e.api.get(`/api/v1/admin/orders/${orderId}`).set(e.auth(admin))).body;
    expect(a.order.paymentStatus).toBe('REFUNDED');
    expect(a.refunds).toHaveLength(1);
    expect(await e.reserved(slot.id)).toBe(0);
    e.clock.t = new Date(e.clock.t.getTime() - 11 * 60_000);
  });

  it('refunds and expires a paid order the shop never answers', async () => {
    const s = await e.studentToken('timeout@srm.test');
    const { orderId, slotId } = await e.placePaidOrder(s, e.shopA.id);
    const held = await e.reserved(slotId);
    e.clock.t = new Date(e.clock.t.getTime() + 91_000); // accept timeout is 90 s
    await expireStaleOrders(e.ctx);
    const a = (await e.api.get(`/api/v1/admin/orders/${orderId}`).set(e.auth(admin))).body;
    expect(a.order).toMatchObject({ status: 'EXPIRED', paymentStatus: 'REFUNDED' });
    expect(await e.reserved(slotId)).toBe(held - 1);
    e.clock.t = new Date(e.clock.t.getTime() - 91_000);
  });
});

describe('14. vendor dashboard recovers state after reload / reconnect', () => {
  it('returns all active paid orders from the database without any socket event, in pickup-time order', async () => {
    const s = await e.studentToken('recover@srm.test');
    const first = await e.placePaidOrder(s, e.shopA.id);
    const second = await e.placePaidOrder(s, e.shopA.id);
    // Simulate a tablet that was offline for both events: a brand-new client just calls the REST endpoint.
    const list = await vendorOrders(vendorA);
    const ids = list.map((o) => o.id);
    expect(ids).toContain(first.orderId);
    expect(ids).toContain(second.orderId);
    expect(list.every((o) => ['AWAITING_VENDOR', 'ACCEPTED', 'PREPARING', 'READY', 'COLLECTED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'NOT_COLLECTED'].includes(o.status))).toBe(true);
    expect(list.some((o) => o.status === 'PENDING_PAYMENT')).toBe(false);
    const times = list.filter((o) => ['AWAITING_VENDOR', 'ACCEPTED'].includes(o.status)).map((o) => o.slotStartsAt);
    expect([...times].sort()).toEqual(times);

    await e.api.post(`/api/v1/vendor/orders/${first.orderId}/accept`).set(e.auth(vendorA));
    const reloaded = (await vendorOrders(vendorA)).find((o) => o.id === first.orderId);
    expect(reloaded.status).toBe('ACCEPTED'); // state comes from the DB, not from a missed event
    const hb = await e.api.post('/api/v1/vendor/heartbeat').set(e.auth(vendorA));
    expect(hb.status).toBe(200);
    expect((await e.api.get('/api/v1/vendor/shop').set(e.auth(vendorA))).body.shop.acceptingOrders).toBe(true);
  });
});

describe('15. admin-only routes reject vendors, students and anonymous callers', () => {
  const adminGets = ['/admin/orders', '/admin/shops', '/admin/payments', '/admin/devices', '/admin/analytics', '/admin/pricing-policies', '/admin/audit-logs', '/admin/export/orders.csv', '/admin/reconciliation', '/admin/complaints'];

  it('401 without a token, 403 for student and vendor tokens', async () => {
    const student = await e.studentToken('rbac@srm.test');
    for (const p of adminGets) {
      expect((await e.api.get(`/api/v1${p}`)).status, `anon ${p}`).toBe(401);
      expect((await e.api.get(`/api/v1${p}`).set(e.auth(student))).status, `student ${p}`).toBe(403);
      expect((await e.api.get(`/api/v1${p}`).set(e.auth(vendorA))).status, `vendor ${p}`).toBe(403);
      expect((await e.api.get(`/api/v1${p}`).set(e.auth(admin))).status, `admin ${p}`).toBe(200);
    }
    expect((await e.api.post('/api/v1/admin/shops').set(e.auth(vendorA)).send({ name: 'x' })).status).toBe(403);
    expect((await e.api.post('/api/v1/admin/refunds').set(e.auth(student)).send({})).status).toBe(403);
    expect((await e.api.get('/api/v1/vendor/orders').set(e.auth(student))).status).toBe(403);
    expect((await e.api.get('/api/v1/vendor/orders').set(e.auth(admin))).status).toBe(403);
    expect((await e.api.post('/api/v1/orders/quote').set(e.auth(vendorA)).send({})).status).toBe(403);
  });

  it('only the platform owner can change pricing, and the change is audited', async () => {
    expect((await e.api.patch('/api/v1/admin/pricing-policy').set(e.auth(admin)).send({ feeRateBps: 500 })).status).toBe(403);
    const ok = await e.api.patch('/api/v1/admin/pricing-policy').set(e.auth(superAdmin)).send({ feeRateBps: 700, note: 'audit check' });
    expect(ok.status).toBe(201);
    const logs = (await e.api.get('/api/v1/admin/audit-logs').set(e.auth(admin))).body.logs;
    expect(logs.some((l: any) => l.action === 'PRICING_POLICY_CREATED')).toBe(true);
  });
});

describe('admin edits shop hours', () => {
  it('rebuilds unbooked pickup times, keeps booked orders, and rejects impossible hours', async () => {
    const created = await e.api.post('/api/v1/admin/shops').set(e.auth(admin)).send({ name: 'Demo Shop D', isDemo: true, openTime: '08:00', closeTime: '22:00', slotMinutes: 10, slotCapacity: 3 });
    const shopId = created.body.shop.id;
    await e.api.patch(`/api/v1/admin/shops/${shopId}`).set(e.auth(admin)).send({ status: 'ACTIVE' });
    const item = await e.api.post(`/api/v1/admin/shops/${shopId}/menu-items`).set(e.auth(admin)).send({ name: 'Demo Idli', basePricePaise: 4000 });
    const before = (await e.api.get(`/api/v1/shops/${shopId}/pickup-slots`)).body.slots as any[];
    const noon = before.find((x) => x.startsAt === '2026-11-09T06:30:00.000Z'); // 12:00 IST
    const evening = before.find((x) => x.startsAt === '2026-11-09T12:30:00.000Z'); // 18:00 IST
    const s = await e.studentToken('hours@srmist.edu.in');
    const order = await e.createOrder(s, shopId, noon.id, [{ menuItemId: item.body.item.id, quantity: 1 }]);
    expect(order.status).toBe(201);

    const upd = await e.api.patch(`/api/v1/admin/shops/${shopId}`).set(e.auth(admin)).send({ openTime: '12:00', closeTime: '14:00', slotMinutes: 15 });
    expect(upd.status).toBe(200);
    expect(upd.body.shop).toMatchObject({ openTime: '12:00', closeTime: '14:00', slotMinutes: 15 });

    const after = (await e.api.get(`/api/v1/shops/${shopId}/pickup-slots`)).body.slots as any[];
    expect(after.length).toBeGreaterThan(0);
    for (const x of after) {
      expect(new Date(x.endsAt).getTime() - new Date(x.startsAt).getTime()).toBe(15 * 60_000);
      expect(x.startsAt >= '2026-11-09T06:30:00.000Z' && x.endsAt <= '2026-11-09T08:30:00.000Z').toBe(true);
    }
    expect(after.some((x) => x.id === noon.id)).toBe(false);
    // Old times can no longer be booked; the booked order keeps its original time.
    const oldBooked = await e.api.post('/api/v1/orders/quote').set(e.auth(s)).send({ shopId, slotId: noon.id, items: [{ menuItemId: item.body.item.id, quantity: 1 }] });
    expect(oldBooked.status).toBe(409);
    const oldFree = await e.api.post('/api/v1/orders/quote').set(e.auth(s)).send({ shopId, slotId: evening.id, items: [{ menuItemId: item.body.item.id, quantity: 1 }] });
    expect(oldFree.status).toBe(404);
    expect((await e.api.get(`/api/v1/orders/${order.body.order.id}`).set(e.auth(s))).body.order.slotStartsAt).toBe('2026-11-09T06:30:00.000Z');

    const bad = await e.api.patch(`/api/v1/admin/shops/${shopId}`).set(e.auth(admin)).send({ closeTime: '11:00' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_HOURS');
    expect((await e.api.post('/api/v1/admin/shops').set(e.auth(admin)).send({ name: 'Bad', openTime: '15:00', closeTime: '09:00' })).status).toBe(400);
    const still = (await e.api.get('/api/v1/admin/shops').set(e.auth(admin))).body.shops.find((x: any) => x.id === shopId);
    expect(still.closeTime).toBe('14:00');
  });
});

describe('admin onboarding, devices, analytics and export', () => {
  it('onboards a shop with a vendor and tablet, and the vendor is scoped to it', async () => {
    const shop = await e.api.post('/api/v1/admin/shops').set(e.auth(admin)).send({ name: 'Demo Shop C', isDemo: true, openTime: '08:00', closeTime: '22:00', slotCapacity: 4 });
    expect(shop.status).toBe(201);
    const shopId = shop.body.shop.id;
    expect((await e.api.patch(`/api/v1/admin/shops/${shopId}`).set(e.auth(admin)).send({ status: 'ACTIVE' })).status).toBe(200);
    expect((await e.api.post('/api/v1/admin/vendors').set(e.auth(admin)).send({ name: 'C Owner', email: 'vendor-c@quickpick.demo', password: 'demo1234', shopId })).status).toBe(201);
    const dev = await e.api.post('/api/v1/admin/devices').set(e.auth(admin)).send({ assetTag: 'JQ-TAB-099', model: 'Test tab' });
    expect(dev.status).toBe(201);
    const assigned = await e.api.post('/api/v1/admin/devices/assign').set(e.auth(admin)).send({ deviceId: dev.body.device.id, shopId });
    expect(assigned.body.device).toMatchObject({ status: 'LOANED', shopId });
    expect((await e.api.post('/api/v1/admin/devices').set(e.auth(admin)).send({ assetTag: 'JQ-TAB-099' })).status).toBe(409);

    const cat = await e.api.post(`/api/v1/admin/shops/${shopId}/categories`).set(e.auth(admin)).send({ name: 'Meals' });
    const item = await e.api.post(`/api/v1/admin/shops/${shopId}/menu-items`).set(e.auth(admin)).send({ name: 'Demo Thali', basePricePaise: 9000, categoryId: cat.body.category.id });
    expect(item.status).toBe(201);
    const vc = await e.staffToken('vendor-c@quickpick.demo');
    expect((await e.api.get('/api/v1/vendor/shop').set(e.auth(vc))).body.shop.id).toBe(shopId);
    expect((await e.api.get(`/api/v1/shops/${shopId}/menu`)).body.items[0].basePricePaise).toBe(9000);

    // Suspended shops disappear from the student app.
    await e.api.patch(`/api/v1/admin/shops/${shopId}`).set(e.auth(admin)).send({ status: 'SUSPENDED' });
    expect((await e.api.get('/api/v1/shops')).body.shops.some((s: any) => s.id === shopId)).toBe(false);
    expect((await e.api.get(`/api/v1/shops/${shopId}`)).status).toBe(404);
  });

  it('reports daily metrics, exports CSV safely and shows the device as online after a heartbeat', async () => {
    await e.api.post('/api/v1/vendor/heartbeat').set(e.auth(vendorA));
    const devices = (await e.api.get('/api/v1/admin/devices').set(e.auth(admin))).body.devices;
    expect(devices.find((d: any) => d.assetTag === 'JQ-TAB-001').online).toBe(true);
    // Rows are stamped with the database clock (real time), so ask for the DB's own IST date.
    const dbDay = String((await e.db.query(`SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS d`))[0].d);
    const a = (await e.api.get(`/api/v1/admin/analytics?date=${dbDay}`).set(e.auth(admin))).body;
    expect(a.orders).toBeGreaterThan(0);
    expect(a.grossFeePaise).toBeGreaterThan(0);
    expect(a.activeShops).toBeGreaterThanOrEqual(2);
    const csv = await e.api.get('/api/v1/admin/export/orders.csv').set(e.auth(admin));
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\n')[0]).toContain('order_number,shop,status');
  });

  it('students can raise a support request on their own order only', async () => {
    const s1 = await e.studentToken('help1@srm.test');
    const s2 = await e.studentToken('help2@srm.test');
    const { orderId } = await e.placePaidOrder(s1, e.shopA.id);
    expect((await e.api.post(`/api/v1/orders/${orderId}/support`).set(e.auth(s2)).send({ category: 'Other', description: 'hi' })).status).toBe(404);
    expect((await e.api.post(`/api/v1/orders/${orderId}/support`).set(e.auth(s1)).send({ category: 'Late', description: 'Still not ready' })).status).toBe(201);
    const c = (await e.api.get('/api/v1/admin/complaints').set(e.auth(admin))).body.complaints;
    expect(c.some((x: any) => x.description === 'Still not ready')).toBe(true);
  });

  it('student cancellation before acceptance refunds a paid order; after acceptance it is refused', async () => {
    const s = await e.studentToken('cancel@srm.test');
    const a = await e.placePaidOrder(s, e.shopA.id);
    const res = await e.api.post(`/api/v1/orders/${a.orderId}/cancel`).set(e.auth(s));
    expect(res.body.order).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });
    const b = await e.placePaidOrder(s, e.shopA.id);
    await e.api.post(`/api/v1/vendor/orders/${b.orderId}/accept`).set(e.auth(vendorA));
    expect((await e.api.post(`/api/v1/orders/${b.orderId}/cancel`).set(e.auth(s))).status).toBe(409);
  });
});
