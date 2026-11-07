import {
  ApiError,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  createApiClient,
  formatPaise,
  type OrderStatus,
  type OrderView,
  type PaymentStatus,
  type PriceBreakdown,
} from '@quickpick/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const api = createApiClient({ baseUrl: API_URL, tokenKey: 'qp_student_token', onUnauthorized: () => window.dispatchEvent(new Event('qp-logout')) });

interface Shop { id: string; name: string; description: string; acceptingOrders: boolean; openNow: boolean; isDemo: boolean }
interface MenuItem { id: string; categoryId: string | null; name: string; description: string; basePricePaise: number; available: boolean }
interface Slot { id: string; startsAt: string; endsAt: string; remaining: number; full: boolean }
interface CartLine { name: string; pricePaise: number; qty: number }
interface Cart { shopId: string; shopName: string; lines: Record<string, CartLine> }

// ---------- tiny hash router ----------
function useRoute(): [string, (to: string) => void] {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setRoute(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (to) => (window.location.hash = to)];
}

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');

function loadCart(): Cart | null {
  try { return JSON.parse(localStorage.getItem('qp_cart') ?? 'null'); } catch { return null; }
}
function saveCart(c: Cart | null) {
  try { if (c) localStorage.setItem('qp_cart', JSON.stringify(c)); else localStorage.removeItem('qp_cart'); } catch { /* ignore */ }
}

export function App() {
  const [route, go] = useRoute();
  const [authed, setAuthed] = useState(!!api.getToken());
  const [cart, setCartState] = useState<Cart | null>(loadCart);
  const setCart = (c: Cart | null) => { setCartState(c); saveCart(c); };

  useEffect(() => {
    const on = () => { api.clearToken(); setAuthed(false); };
    window.addEventListener('qp-logout', on);
    return () => window.removeEventListener('qp-logout', on);
  }, []);

  const cartCount = cart ? Object.values(cart.lines).reduce((s, l) => s + l.qty, 0) : 0;
  const [path, id] = [route.split('/')[1] ?? '', route.split('/')[2]];

  return (
    <div className="app">
      <div className="sandbox-banner">SANDBOX — test payments only. No real money is taken.</div>
      <div className="topbar">
        <a href="#/"><span className="brand">☕ Java QuickPick</span><div className="tagline">Order ahead. Pick up on time.</div></a>
        <div className="row">
          {authed && <a href="#/orders">My orders</a>}
          {authed && <button className="link" onClick={() => { api.clearToken(); setAuthed(false); }}>Sign out</button>}
        </div>
      </div>
      <div className="page">
        {!authed ? (
          <Login onDone={() => setAuthed(true)} />
        ) : path === 'shop' && id ? (
          <ShopMenu shopId={id} cart={cart} setCart={setCart} go={go} />
        ) : path === 'checkout' ? (
          <Checkout cart={cart} setCart={setCart} go={go} />
        ) : path === 'order' && id ? (
          <OrderPage orderId={id} go={go} />
        ) : path === 'orders' ? (
          <History />
        ) : (
          <Shops />
        )}
      </div>
      {authed && cart && cartCount > 0 && path === 'shop' && (
        <div className="cart-bar"><div className="inner">
          <button className="primary" onClick={() => go('/checkout')}>View cart · {cartCount} item{cartCount > 1 ? 's' : ''} · {formatPaise(Object.values(cart.lines).reduce((s, l) => s + l.pricePaise * l.qty, 0))}</button>
        </div></div>
      )}
    </div>
  );
}

// ---------- login (OTP; dev code is echoed by the sandbox API) ----------
function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const request = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ devCode?: string }>('/auth/otp/request', { email });
      setSent(true); setDevCode(r.devCode ?? null);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ token: string }>('/auth/otp/verify', { email, code, name: name || undefined });
      api.setToken(r.token); onDone();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <div><h1>Skip the ordering queue</h1><p className="muted">Order and pay before you reach the counter, then pick up at your chosen time. Pickup times depend on each kitchen’s capacity.</p></div>
      <div className="card stack">
        <div className="field"><label htmlFor="email">College email</label><input id="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" disabled={sent} /></div>
        {!sent && <div className="field"><label htmlFor="name">Your name</label><input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="First name" /></div>}
        {sent && (
          <div className="field">
            <label htmlFor="code">6-digit code</label>
            <input id="code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            {devCode && <p className="notice small" style={{ marginTop: 8 }}>Sandbox: your code is <b>{devCode}</b> (real SMS/email delivery is not connected yet).</p>}
          </div>
        )}
        {err && <div className="error" role="alert">{err}</div>}
        {!sent ? <button className="primary" disabled={busy || !email} onClick={request}>Send code</button> : <button className="primary" disabled={busy || code.length !== 6} onClick={verify}>Sign in</button>}
      </div>
    </div>
  );
}

// ---------- shops ----------
function Shops() {
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get<{ shops: Shop[] }>('/shops').then((r) => setShops(r.shops)).catch((e) => setErr(errMsg(e))); }, []);
  if (err) return <div className="error">{err}</div>;
  if (!shops) return <p className="muted">Loading shops…</p>;
  return (
    <div className="stack">
      <h2>Java food court</h2>
      {shops.length === 0 && <div className="empty">No shops are taking orders right now.</div>}
      {shops.map((s) => (
        <a key={s.id} className="card shop-card" href={`#/shop/${s.id}`}>
          <div className="row between"><h3>{s.name}</h3>{s.acceptingOrders && s.openNow ? <span className="badge ok">Open</span> : s.acceptingOrders ? <span className="badge warn">Closed now</span> : <span className="badge bad">Paused</span>}</div>
          <p className="muted small">{s.description}</p>
          {s.isDemo && <span className="badge info">Demo data</span>}
        </a>
      ))}
    </div>
  );
}

// ---------- menu + cart (one shop per order) ----------
function ShopMenu({ shopId, cart, setCart, go }: { shopId: string; cart: Cart | null; setCart: (c: Cart | null) => void; go: (t: string) => void }) {
  const [data, setData] = useState<{ shop: Shop; categories: { id: string; name: string }[]; items: MenuItem[] } | null>(null);
  const [err, setErr] = useState('');
  const [pendingSwitch, setPendingSwitch] = useState<MenuItem | null>(null);
  useEffect(() => { api.get<any>(`/shops/${shopId}/menu`).then(setData).catch((e) => setErr(errMsg(e))); }, [shopId]);
  if (err) return <div className="error">{err} <a href="#/">Back</a></div>;
  if (!data) return <p className="muted">Loading menu…</p>;
  const { shop } = data;
  const mine = cart && cart.shopId === shopId ? cart : null;

  const add = (item: MenuItem, delta: number) => {
    if (cart && cart.shopId !== shopId && delta > 0) { setPendingSwitch(item); return; }
    const base: Cart = mine ?? { shopId, shopName: shop.name, lines: {} };
    const cur = base.lines[item.id]?.qty ?? 0;
    const qty = Math.max(0, Math.min(20, cur + delta));
    const lines = { ...base.lines };
    if (qty === 0) delete lines[item.id]; else lines[item.id] = { name: item.name, pricePaise: item.basePricePaise, qty };
    setCart(Object.keys(lines).length ? { ...base, lines } : null);
  };

  const sections = [...data.categories, { id: '', name: 'Other' }].map((c) => ({ ...c, items: data.items.filter((i) => (i.categoryId ?? '') === c.id) })).filter((c) => c.items.length);
  const blocked = !shop.acceptingOrders;

  return (
    <div className="stack">
      <a href="#/">← All shops</a>
      <div><h2>{shop.name}</h2><p className="muted small">{shop.description}</p></div>
      {blocked && <div className="error">This shop has paused QuickPick orders. Please check back soon.</div>}
      {pendingSwitch && (
        <div className="card stack" role="alertdialog">
          <p><b>One shop per order.</b> Your cart has items from {cart?.shopName}. Clear it to start an order from {shop.name}?</p>
          <div className="row"><button className="primary" onClick={() => { setCart(null); const it = pendingSwitch; setPendingSwitch(null); setTimeout(() => add(it, 1), 0); }}>Clear cart & switch</button><button onClick={() => setPendingSwitch(null)}>Keep my cart</button></div>
        </div>
      )}
      <p className="small muted">Prices shown are the shop’s menu prices. A QuickPick convenience fee is added and shown in full before you pay.</p>
      {sections.map((sec) => (
        <div key={sec.id || 'other'} className="card">
          <h3>{sec.name}</h3>
          {sec.items.map((it) => {
            const qty = mine?.lines[it.id]?.qty ?? 0;
            return (
              <div key={it.id} className={'item' + (it.available ? '' : ' unavailable')}>
                <div className="thumb" aria-hidden>🍽</div>
                <div className="grow"><b>{it.name}</b><div className="muted small">{it.description}</div><div className="price">{formatPaise(it.basePricePaise)}</div></div>
                {!it.available ? <span className="badge bad">Unavailable</span> : qty === 0 ? (
                  <button disabled={blocked} onClick={() => add(it, 1)}>Add</button>
                ) : (
                  <div className="qty"><button aria-label={`Remove one ${it.name}`} onClick={() => add(it, -1)}>−</button><span>{qty}</span><button aria-label={`Add one ${it.name}`} onClick={() => add(it, 1)}>+</button></div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {mine && <button className="primary" onClick={() => go('/checkout')}>Go to checkout</button>}
    </div>
  );
}

// ---------- checkout ----------
interface Quote { shopName: string; slot: { id: string; startsAt: string; endsAt: string }; breakdown: PriceBreakdown; policyApproved: boolean }

function Checkout({ cart, setCart, go }: { cart: Cart | null; setCart: (c: Cart | null) => void; go: (t: string) => void }) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotId, setSlotId] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<OrderView | null>(null);
  const idemKey = useRef(crypto.randomUUID());

  const items = useMemo(() => (cart ? Object.entries(cart.lines).map(([menuItemId, l]) => ({ menuItemId, quantity: l.qty })) : []), [cart]);

  useEffect(() => {
    if (!cart) return;
    api.get<{ slots: Slot[] }>(`/shops/${cart.shopId}/pickup-slots`).then((r) => setSlots(r.slots)).catch((e) => setErr(errMsg(e)));
  }, [cart?.shopId]);

  useEffect(() => {
    if (!cart || !slotId) { setQuote(null); return; }
    setErr('');
    api.post<Quote>('/orders/quote', { shopId: cart.shopId, slotId, items }).then(setQuote).catch((e) => { setQuote(null); setErr(errMsg(e)); });
  }, [slotId, cart, items]);

  if (!cart || items.length === 0) return <div className="empty">Your cart is empty. <a href="#/">Browse shops</a></div>;

  const placeOrder = async () => {
    setBusy(true); setErr('');
    try {
      const created = await api.post<{ order: OrderView }>('/orders', { shopId: cart.shopId, slotId, items }, { 'Idempotency-Key': idemKey.current });
      await api.post('/payments/checkout', { orderId: created.order.id });
      setOrder(created.order);
    } catch (e) { setErr(errMsg(e)); idemKey.current = crypto.randomUUID(); } finally { setBusy(false); }
  };

  const simulate = async (outcome: 'success' | 'failure') => {
    if (!order) return;
    setBusy(true); setErr('');
    try {
      await api.post('/sandbox/payments/simulate', { orderId: order.id, outcome });
      if (outcome === 'success') setCart(null);
      go(`/order/${order.id}`);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <a href={`#/shop/${cart.shopId}`}>← Back to menu</a>
      <h2>Checkout · {cart.shopName}</h2>
      <div className="card">
        {Object.entries(cart.lines).map(([id, l]) => (
          <div key={id} className="row between"><span>{l.qty} × {l.name}</span><span className="price">{formatPaise(l.pricePaise * l.qty)}</span></div>
        ))}
      </div>

      {!order && (
        <>
          <div className="card">
            <h3>Pick a pickup time</h3>
            {!slots ? <p className="muted">Loading times…</p> : slots.length === 0 ? <p className="muted">No pickup times left today.</p> : (
              <div className="slots">
                {slots.map((s) => (
                  <button key={s.id} className={'slot' + (slotId === s.id ? ' selected' : '')} disabled={s.full} onClick={() => setSlotId(s.id)}>
                    {fmtTime(s.startsAt)}<small>{s.full ? 'Full' : `${s.remaining} left`}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          {quote && <Breakdown b={quote.breakdown} unapproved={!quote.policyApproved} />}
          {err && <div className="error" role="alert">{err}</div>}
          <button className="primary" disabled={busy || !quote} onClick={placeOrder}>{quote ? `Continue to payment · ${formatPaise(quote.breakdown.totalPaise)}` : 'Choose a pickup time'}</button>
          <button onClick={() => { setCart(null); go('/'); }}>Clear cart</button>
        </>
      )}

      {order && (
        <div className="sandbox-box stack">
          <h3>Sandbox payment · {order.orderNumber}</h3>
          <p className="small">No real money moves. Choose what the test payment provider reports — it is delivered as a <b>signed webhook</b>, and only that confirms payment.</p>
          <p className="price">Total to pay: {formatPaise(order.totalPaise)}</p>
          {err && <div className="error" role="alert">{err}</div>}
          <div className="row wrap"><button className="ok grow" disabled={busy} onClick={() => simulate('success')}>Simulate successful payment</button><button className="danger grow" disabled={busy} onClick={() => simulate('failure')}>Simulate failed payment</button></div>
        </div>
      )}
    </div>
  );
}

function Breakdown({ b, unapproved }: { b: PriceBreakdown; unapproved: boolean }) {
  return (
    <div className="card breakdown">
      <h3>Price breakdown</h3>
      <div className="line"><span>Food subtotal (shop prices)</span><span className="price">{formatPaise(b.subtotalPaise)}</span></div>
      <div className="line"><span>QuickPick convenience fee ({(b.feeRateBps / 100).toString()}%)</span><span className="price">{formatPaise(b.feePaise)}</span></div>
      {b.taxMode === 'EXCLUSIVE' && <div className="line"><span>Tax on fee ({(b.taxRateBps / 100).toString()}%)</span><span className="price">{formatPaise(b.taxPaise)}</span></div>}
      {b.taxMode === 'INCLUSIVE' && <div className="line muted small"><span>Fee includes tax of</span><span className="price">{formatPaise(b.taxPaise)}</span></div>}
      <div className="line total"><span>Total payable</span><span className="price">{formatPaise(b.totalPaise)}</span></div>
      <p className="muted small">Walk-in customers do not pay this fee. It covers ordering ahead and scheduled pickup.</p>
      {unapproved && <p className="small" style={{ color: 'var(--warn)' }}>Sandbox pricing: tax treatment of the fee is not yet approved.</p>}
    </div>
  );
}

// ---------- order tracking ----------
const FLOW: OrderStatus[] = ['AWAITING_VENDOR', 'ACCEPTED', 'PREPARING', 'READY', 'COLLECTED'];
const END_BAD: OrderStatus[] = ['REJECTED', 'CANCELLED', 'EXPIRED', 'NOT_COLLECTED'];
const statusTone = (s: OrderStatus) => (s === 'READY' || s === 'COLLECTED' ? 'ok' : END_BAD.includes(s) ? 'bad' : s === 'PENDING_PAYMENT' ? 'warn' : 'primary');

function useOrderLive(orderId: string, onChange: () => void) {
  useEffect(() => {
    const t = setInterval(onChange, 6000);
    const token = api.getToken();
    const socket = token ? io(API_URL, { auth: { token }, transports: ['websocket', 'polling'] }) : null;
    socket?.on('order', (e: { orderId: string }) => { if (e.orderId === orderId) onChange(); });
    socket?.on('connect', onChange); // refetch after any reconnect
    return () => { clearInterval(t); socket?.close(); };
  }, [orderId, onChange]);
}

function OrderPage({ orderId, go }: { orderId: string; go: (t: string) => void }) {
  const [data, setData] = useState<{ order: OrderView; events: { status: OrderStatus; reason: string | null; at: string }[]; refunds: { amountPaise: number; status: string }[] } | null>(null);
  const [err, setErr] = useState('');
  const [help, setHelp] = useState(false);
  const [helpText, setHelpText] = useState('');
  const [sent, setSent] = useState(false);
  const load = useCallback(() => { api.get<any>(`/orders/${orderId}`).then(setData).catch((e) => setErr(errMsg(e))); }, [orderId]);
  useEffect(load, [load]);
  useOrderLive(orderId, load);

  if (err && !data) return <div className="error">{err} <a href="#/orders">My orders</a></div>;
  if (!data) return <p className="muted">Loading order…</p>;
  const { order } = data;
  const idx = FLOW.indexOf(order.status);
  const cancellable = order.status === 'PENDING_PAYMENT' || order.status === 'AWAITING_VENDOR';

  return (
    <div className="stack">
      <a href="#/orders">← My orders</a>
      <div className="row between"><h2>{order.orderNumber}</h2><span className={'badge ' + statusTone(order.status)}>{ORDER_STATUS_LABEL[order.status]}</span></div>
      <p className="muted">{order.shopName} · pickup {fmtTime(order.slotStartsAt)}–{fmtTime(order.slotEndsAt)}</p>

      {order.status === 'READY' && <div className="notice"><b>Your order is ready!</b> Head to {order.shopName} and show your pickup code.</div>}
      {order.pickupCode && !END_BAD.includes(order.status) && order.status !== 'PENDING_PAYMENT' && (<div><label>Pickup code — show this at the counter</label><div className="pickup-code">{order.pickupCode}</div></div>)}

      {!END_BAD.includes(order.status) && order.status !== 'PENDING_PAYMENT' && (
        <ul className="tracker" aria-label="Order progress">
          {FLOW.map((s, i) => (
            <li key={s} className={i < idx || order.status === 'COLLECTED' ? 'done' : i === idx ? 'current' : ''}>
              <span className="dot">{i < idx || order.status === 'COLLECTED' ? '✓' : ''}</span>{ORDER_STATUS_LABEL[s]}
            </li>
          ))}
        </ul>
      )}
      {END_BAD.includes(order.status) && <div className="error">{ORDER_STATUS_LABEL[order.status]}{data.events.at(-1)?.reason ? ` — ${data.events.at(-1)!.reason}` : ''}</div>}
      {order.status === 'PENDING_PAYMENT' && <div className="notice">Waiting for payment confirmation. <button className="small" onClick={() => go('/checkout')}>Back to checkout</button></div>}

      <div className="card breakdown">
        {order.items.map((i) => <div className="line" key={i.menuItemId}><span>{i.quantity} × {i.name}</span><span className="price">{formatPaise(i.lineTotalPaise)}</span></div>)}
        <div className="line muted"><span>QuickPick fee ({order.feeRateBps / 100}%)</span><span className="price">{formatPaise(order.feePaise)}</span></div>
        {order.taxPaise > 0 && <div className="line muted"><span>Tax</span><span className="price">{formatPaise(order.taxPaise)}</span></div>}
        <div className="line total"><span>Total</span><span className="price">{formatPaise(order.totalPaise)}</span></div>
        <div className="row between"><span className="small muted">Payment</span><span className={'badge ' + (order.paymentStatus === 'SUCCEEDED' ? 'ok' : order.paymentStatus === 'FAILED' ? 'bad' : 'warn')}>{PAYMENT_STATUS_LABEL[order.paymentStatus as PaymentStatus]}</span></div>
      </div>

      {data.refunds.length > 0 && <div className="card"><h3>Refund</h3>{data.refunds.map((r, i) => <div className="row between" key={i}><span>{formatPaise(r.amountPaise)}</span><span className={'badge ' + (r.status === 'PROCESSED' ? 'ok' : 'warn')}>{r.status === 'PROCESSED' ? 'Refunded' : 'In progress'}</span></div>)}</div>}
      {err && <div className="error">{err}</div>}
      {cancellable && <button className="danger" onClick={async () => { try { await api.post(`/orders/${orderId}/cancel`); load(); } catch (e) { setErr(errMsg(e)); } }}>Cancel order{order.paymentStatus === 'SUCCEEDED' ? ' (full refund)' : ''}</button>}
      {!sent ? (!help ? <button onClick={() => setHelp(true)}>Report a problem with this order</button> : (
        <div className="card stack"><label htmlFor="help">What went wrong?</label><textarea id="help" rows={3} value={helpText} onChange={(e) => setHelpText(e.target.value)} />
          <button className="primary" disabled={!helpText.trim()} onClick={async () => { try { await api.post(`/orders/${orderId}/support`, { category: 'Order issue', description: helpText }); setSent(true); } catch (e) { setErr(errMsg(e)); } }}>Send to support</button></div>
      )) : <div className="notice">Thanks — our team will look into it.</div>}
    </div>
  );
}

function History() {
  const [orders, setOrders] = useState<OrderView[] | null>(null);
  useEffect(() => { api.get<{ orders: OrderView[] }>('/me/orders').then((r) => setOrders(r.orders)).catch(() => setOrders([])); }, []);
  if (!orders) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <h2>My orders</h2>
      {orders.length === 0 && <div className="empty">No orders yet. <a href="#/">Browse shops</a></div>}
      {orders.map((o) => (
        <a key={o.id} className="card shop-card" href={`#/order/${o.id}`}>
          <div className="row between"><b>{o.orderNumber}</b><span className={'badge ' + statusTone(o.status)}>{ORDER_STATUS_LABEL[o.status]}</span></div>
          <div className="row between muted small"><span>{o.shopName} · {fmtTime(o.slotStartsAt)}</span><span className="price">{formatPaise(o.totalPaise)}</span></div>
        </a>
      ))}
    </div>
  );
}
