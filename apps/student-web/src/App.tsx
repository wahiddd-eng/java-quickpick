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
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const api = createApiClient({ baseUrl: API_URL, tokenKey: 'qp_student_token', onUnauthorized: () => window.dispatchEvent(new Event('qp-logout')) });

interface Shop { id: string; name: string; description: string; acceptingOrders: boolean; openNow: boolean; isDemo: boolean; openTime?: string; closeTime?: string }
interface MenuItem { id: string; categoryId: string | null; name: string; description: string; basePricePaise: number; available: boolean }
interface Slot { id: string; startsAt: string; endsAt: string; remaining: number; full: boolean }
interface CartLine { name: string; pricePaise: number; qty: number }
interface Cart { shopId: string; shopName: string; lines: Record<string, CartLine> }

// ---------- helpers ----------
function useRoute(): [string, (to: string) => void] {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => { setRoute(window.location.hash.slice(1) || '/'); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (to) => (window.location.hash = to)];
}

const IST = 'Asia/Kolkata';
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST }).replace(' ', ' ');
const fmtDay = (iso: string) => {
  const d = new Date(iso);
  const key = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: IST });
  if (key(d) === key(new Date())) return 'Today';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: IST });
};
const fmtClock = (hhmm?: string) => {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}\u202f${suffix}`;
};
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Couldn’t reach QuickPick. Check your connection and try again.');
const initials = (name: string) => {
  const w = name.split(/\s+/).filter((x) => /[a-z0-9]/i.test(x));
  return ((w[0]?.[0] ?? '') + (w.length > 1 ? w[w.length - 1]![0] : '')).toUpperCase();
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function loadCart(): Cart | null {
  try { return JSON.parse(localStorage.getItem('qp_cart') ?? 'null'); } catch { return null; }
}
function saveCart(c: Cart | null) {
  try { if (c) localStorage.setItem('qp_cart', JSON.stringify(c)); else localStorage.removeItem('qp_cart'); } catch { /* storage unavailable */ }
}
const cartCount = (c: Cart | null) => (c ? Object.values(c.lines).reduce((s, l) => s + l.qty, 0) : 0);
const cartTotal = (c: Cart | null) => (c ? Object.values(c.lines).reduce((s, l) => s + l.pricePaise * l.qty, 0) : 0);

// ---------- icons ----------
const Icon = {
  chevronRight: <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>,
  chevronLeft: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 6-6 6 6 6" /></svg>,
  check: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5 10 17l9-10" /></svg>,
  bag: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 8h12l-1 12H7L6 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>,
  cup: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 9h13v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6V9Z" /><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17" /><path d="M8 3v3M12 3v3" /></svg>,
};

const Back = ({ href, children }: { href: string; children: ReactNode }) => <a className="back" href={href}>{Icon.chevronLeft}{children}</a>;
const Alert = ({ tone, children }: { tone: 'error' | 'info' | 'warn' | 'good'; children: ReactNode }) => <div className={`alert ${tone}`} role={tone === 'error' ? 'alert' : undefined}>{children}</div>;

// ---------- app ----------
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

  const [path, id] = [route.split('/')[1] ?? '', route.split('/')[2]];
  const count = cartCount(cart);

  return (
    <div className="shell">
      <div className="testmode">Test mode: payments are simulated and no money is charged</div>
      <header className="header">
        <a className="wordmark" href="#/" aria-label="QuickPick home">
          <span className="mark">{Icon.cup}</span>
          <span><b>QuickPick</b><span>Java food court, SRM KTR</span></span>
        </a>
        {authed && (
          <nav aria-label="Account">
            <a className={'navlink' + (path === 'orders' || path === 'order' ? ' active' : '')} href="#/orders">Orders</a>
            <button className="navlink" onClick={() => { api.clearToken(); setAuthed(false); go('/'); }}>Sign out</button>
          </nav>
        )}
      </header>

      <main>
        {!authed ? (
          <Login onDone={() => setAuthed(true)} />
        ) : path === 'shop' && id ? (
          <ShopMenu shopId={id} cart={cart} setCart={setCart} />
        ) : path === 'checkout' ? (
          <Checkout cart={cart} setCart={setCart} go={go} />
        ) : path === 'order' && id ? (
          <OrderPage orderId={id} />
        ) : path === 'orders' ? (
          <History />
        ) : (
          <Shops cart={cart} />
        )}
      </main>

      {authed && cart && count > 0 && (path === 'shop' || path === '') && (
        <div className="dock"><div className="dock-inner">
          <button className="cartbar" onClick={() => go('/checkout')}>
            <span><span className="count">{plural(count, 'item')} from {cart.shopName}</span><span className="total">{formatPaise(cartTotal(cart))}</span></span>
            <span className="go">Review order {Icon.chevronRight}</span>
          </button>
        </div></div>
      )}
    </div>
  );
}

// ---------- sign in (OTP; the sandbox API echoes the code) ----------
function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const request = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ devCode?: string }>('/auth/otp/request', { email });
      setSent(true); setDevCode(r.devCode ?? null);
    } catch (er) { setErr(errMsg(er)); } finally { setBusy(false); }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ token: string }>('/auth/otp/verify', { email, code, name: name || undefined });
      api.setToken(r.token); onDone();
    } catch (er) { setErr(errMsg(er)); } finally { setBusy(false); }
  };

  return (
    <div className="signin">
      <h1>Order ahead. Skip the counter queue.</h1>
      <p className="lede">Choose your food, pick a time and pay on your phone. Collect it from the shop with a 4-digit code.</p>

      {!sent ? (
        <form onSubmit={request}>
          <div className="field"><label htmlFor="name">Your name</label><input id="name" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="First name" /></div>
          <div className="field"><label htmlFor="email">College email</label><input id="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@srmist.edu.in" required /></div>
          {err && <div style={{ marginTop: 14 }}><Alert tone="error">{err}</Alert></div>}
          <button className="btn primary block" disabled={busy || !email}>{busy ? 'Sending code…' : 'Send sign-in code'}</button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <div className="field">
            <label htmlFor="code">Enter the 6-digit code</label>
            <input id="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
            <p className="hint">Sent to {email}. <button type="button" className="linkbtn" onClick={() => { setSent(false); setCode(''); setErr(''); }}>Use a different email</button></p>
          </div>
          {devCode && <div style={{ marginTop: 14 }}><Alert tone="warn"><span>Test mode: your code is <b className="num">{devCode}</b>. Email delivery isn’t connected yet.</span></Alert></div>}
          {err && <div style={{ marginTop: 14 }}><Alert tone="error">{err}</Alert></div>}
          <button className="btn primary block" disabled={busy || code.length !== 6}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      )}

      <ol className="how" aria-label="How it works">
        <li><span className="step">1</span><span><b>Pick a shop and your food</b>One shop per order, at the shop’s own menu prices.</span></li>
        <li><span className="step">2</span><span><b>Choose a pickup time</b>Times fill up as each kitchen reaches its limit.</span></li>
        <li><span className="step">3</span><span><b>Collect with your code</b>We’ll tell you the moment it’s ready.</span></li>
      </ol>
    </div>
  );
}

// ---------- shops ----------
function ShopStatus({ shop }: { shop: Shop }) {
  if (!shop.acceptingOrders) return <span className="pill bad">Paused</span>;
  if (!shop.openNow) return <span className="pill">Closed</span>;
  return <span className="pill open">Open</span>;
}

function Shops({ cart }: { cart: Cart | null }) {
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get<{ shops: Shop[] }>('/shops').then((r) => setShops(r.shops)).catch((e) => setErr(errMsg(e))); }, []);

  return (
    <>
      <div className="page-head">
        <h1>Shops at Java</h1>
        <p>Order from one shop at a time. You’ll see every charge before you pay.</p>
      </div>
      {err && <Alert tone="error">{err}</Alert>}
      {!shops && !err && <p className="loading">Loading shops…</p>}
      {shops && shops.length === 0 && <div className="empty"><h2>No shops are taking orders</h2><p>Check back closer to lunch.</p></div>}
      {shops && shops.length > 0 && (
        <ul className="list">
          {shops.map((s) => (
            <li key={s.id}>
              <a className="row-link" href={`#/shop/${s.id}`}>
                <span className="monogram" aria-hidden>{initials(s.name)}</span>
                <span className="grow">
                  <span className="row-title"><h2>{s.name}</h2><ShopStatus shop={s} /></span>
                  {s.description && <span className="row-desc" style={{ display: 'block' }}>{s.description}</span>}
                  <span className="row-meta">
                    {s.openTime && <span>{fmtClock(s.openTime)} – {fmtClock(s.closeTime)}</span>}
                    {cart?.shopId === s.id && <span style={{ color: 'var(--leaf)', fontWeight: 600 }}>{plural(cartCount(cart), 'item')} in your cart</span>}
                    {s.isDemo && <span>Demo shop</span>}
                  </span>
                </span>
                {Icon.chevronRight}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------- menu + cart (one shop per order) ----------
function ShopMenu({ shopId, cart, setCart }: { shopId: string; cart: Cart | null; setCart: (c: Cart | null) => void }) {
  const [data, setData] = useState<{ shop: Shop; categories: { id: string; name: string }[]; items: MenuItem[] } | null>(null);
  const [err, setErr] = useState('');
  const [pendingSwitch, setPendingSwitch] = useState<MenuItem | null>(null);
  useEffect(() => { api.get<any>(`/shops/${shopId}/menu`).then(setData).catch((e) => setErr(errMsg(e))); }, [shopId]);

  if (err) return <><Back href="#/">All shops</Back><Alert tone="error">{err}</Alert></>;
  if (!data) return <p className="loading">Loading menu…</p>;
  const { shop } = data;
  const mine = cart && cart.shopId === shopId ? cart : null;

  const change = (item: MenuItem, delta: number, base: Cart | null = mine) => {
    const b: Cart = base ?? { shopId, shopName: shop.name, lines: {} };
    const qty = Math.max(0, Math.min(20, (b.lines[item.id]?.qty ?? 0) + delta));
    const lines = { ...b.lines };
    if (qty === 0) delete lines[item.id]; else lines[item.id] = { name: item.name, pricePaise: item.basePricePaise, qty };
    setCart(Object.keys(lines).length ? { ...b, lines } : null);
  };
  const add = (item: MenuItem) => {
    if (cart && cart.shopId !== shopId) { setPendingSwitch(item); return; }
    change(item, 1);
  };

  const sections = [...data.categories, { id: '', name: 'More' }]
    .map((c) => ({ ...c, items: data.items.filter((i) => (i.categoryId ?? '') === c.id) }))
    .filter((c) => c.items.length);
  const blocked = !shop.acceptingOrders;

  return (
    <>
      <Back href="#/">All shops</Back>
      <div className="shop-head">
        <h1>{shop.name}</h1>
        {shop.description && <p className="sub" style={{ marginTop: 6 }}>{shop.description}</p>}
        <div className="row-meta"><ShopStatus shop={shop} />{shop.openTime && <span>Pickup {fmtClock(shop.openTime)} – {fmtClock(shop.closeTime)}</span>}</div>
      </div>
      {blocked && <div style={{ marginTop: 16 }}><Alert tone="error">This shop has paused online orders. You can still order at the counter.</Alert></div>}
      {pendingSwitch && (
        <div className="dialog" role="alertdialog" aria-labelledby="switch-title">
          <h2 id="switch-title">Start a new order?</h2>
          <p className="sub" style={{ marginTop: 6 }}>Your cart has items from {cart?.shopName}. Each order comes from one shop, so adding this will clear your cart.</p>
          <div className="actions">
            <button className="btn" onClick={() => setPendingSwitch(null)}>Keep my cart</button>
            <button className="btn primary" onClick={() => { const it = pendingSwitch; setPendingSwitch(null); change(it, 1, null); }}>Clear and add</button>
          </div>
        </div>
      )}
      <p className="fee-note">Prices are the shop’s own menu prices. A QuickPick convenience fee is added at checkout.</p>

      {sections.length > 1 && (
        <nav className="chips" aria-label="Menu sections">
          {sections.map((sec) => <button key={sec.id || 'more'} className="chip" onClick={() => document.getElementById(`cat-${sec.id || 'more'}`)?.scrollIntoView({ behavior: 'smooth' })}>{sec.name}</button>)}
        </nav>
      )}

      {sections.map((sec) => (
        <section key={sec.id || 'more'} id={`cat-${sec.id || 'more'}`} className="category" aria-label={sec.name}>
          {sections.length > 1 && <h2>{sec.name}</h2>}
          {sec.items.map((it) => {
            const qty = mine?.lines[it.id]?.qty ?? 0;
            return (
              <div key={it.id} className={'dish' + (it.available ? '' : ' off')}>
                <div className="grow">
                  <h3>{it.name}</h3>
                  {it.description && <p className="desc">{it.description}</p>}
                  <p className="price">{formatPaise(it.basePricePaise)}</p>
                </div>
                {!it.available ? <span className="soldout">Sold out</span> : qty === 0 ? (
                  <button className="add" disabled={blocked} onClick={() => add(it)} aria-label={`Add ${it.name}`}>Add</button>
                ) : (
                  <div className="stepper" role="group" aria-label={`${it.name} quantity`}>
                    <button aria-label={`Remove one ${it.name}`} onClick={() => change(it, -1)}>−</button>
                    <span aria-live="polite">{qty}</span>
                    <button aria-label={`Add one ${it.name}`} onClick={() => change(it, 1)}>+</button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </>
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

  if (!cart || items.length === 0) {
    return <div className="empty"><h2>Your cart is empty</h2><p>Add something from a shop to start an order.</p><a className="btn primary" href="#/">Browse shops</a></div>;
  }

  const placeOrder = async () => {
    setBusy(true); setErr('');
    try {
      const created = await api.post<{ order: OrderView }>('/orders', { shopId: cart.shopId, slotId, items }, { 'Idempotency-Key': idemKey.current });
      await api.post('/payments/checkout', { orderId: created.order.id });
      setOrder(created.order);
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
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

  const chosen = slots?.find((s) => s.id === slotId);

  return (
    <>
      <Back href={`#/shop/${cart.shopId}`}>{cart.shopName}</Back>
      <div className="page-head"><h1>Review your order</h1></div>

      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head"><h2>{cart.shopName}</h2>{!order && <a className="small" style={{ fontWeight: 600 }} href={`#/shop/${cart.shopId}`}>Edit items</a>}</div>
        <ul className="lines">
          {Object.entries(cart.lines).map(([id, l]) => (
            <li key={id}><span className="qty">{l.qty}×</span><span>{l.name}</span><span className="amt">{formatPaise(l.pricePaise * l.qty)}</span></li>
          ))}
        </ul>
      </section>

      <section className="section">
        <div className="section-head"><h2>Pickup time</h2>{chosen && <span className="small sub">Ready from {fmtTime(chosen.startsAt)}</span>}</div>
        {!slots ? <p className="loading">Loading pickup times…</p> : slots.length === 0 ? (
          <Alert tone="info">No pickup times are left today. The shop may be closed or fully booked.</Alert>
        ) : (
          <div className="slots" role="group" aria-label="Pickup times">
            {slots.map((s) => (
              <button key={s.id} className={'slot' + (!s.full && s.remaining <= 2 ? ' low' : '')} aria-pressed={slotId === s.id} disabled={s.full || !!order} onClick={() => setSlotId(s.id)}>
                <b>{fmtTime(s.startsAt)}</b><small>{s.full ? 'Full' : `${s.remaining} left`}</small>
              </button>
            ))}
          </div>
        )}
      </section>

      {quote && (
        <section className="section">
          <h2>Payment summary</h2>
          <Breakdown b={quote.breakdown} unapproved={!quote.policyApproved} />
        </section>
      )}

      {err && <div style={{ marginTop: 20 }}><Alert tone="error">{err}</Alert></div>}

      {order ? (
        <div className="testpay">
          <h2>Test payment</h2>
          <p>Order {order.orderNumber}. Nothing is charged. Choose how the test payment should end; the order only updates once the payment provider confirms it.</p>
          <p className="amount">{formatPaise(order.totalPaise)}</p>
          <div className="actions">
            <button className="btn primary" disabled={busy} onClick={() => simulate('success')}>Complete test payment</button>
            <button className="btn danger" disabled={busy} onClick={() => simulate('failure')}>Make the payment fail</button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 24 }}>
          <button className="btn quiet block" onClick={() => { setCart(null); go('/'); }}>Clear cart</button>
        </div>
      )}

      {!order && (
        <div className="dock"><div className="dock-inner">
          <button className="btn primary" disabled={busy || !quote} onClick={placeOrder}>
            {busy ? 'Placing order…' : quote ? `Pay ${formatPaise(quote.breakdown.totalPaise)}` : 'Choose a pickup time'}
          </button>
        </div></div>
      )}
    </>
  );
}

function Breakdown({ b, unapproved }: { b: PriceBreakdown; unapproved: boolean }) {
  return (
    <div className="summary">
      <div className="line"><span>Food</span><span>{formatPaise(b.subtotalPaise)}</span></div>
      <div className="line"><span>QuickPick fee ({b.feeRateBps / 100}%)</span><span>{formatPaise(b.feePaise)}</span></div>
      {b.taxMode === 'EXCLUSIVE' && <div className="line"><span>Tax on fee ({b.taxRateBps / 100}%)</span><span>{formatPaise(b.taxPaise)}</span></div>}
      {b.taxMode === 'INCLUSIVE' && <div className="line minor"><span>Fee includes tax of</span><span>{formatPaise(b.taxPaise)}</span></div>}
      <div className="line total"><span>Total</span><span>{formatPaise(b.totalPaise)}</span></div>
      <p className="note">The shop receives its full menu price. The fee pays for ordering ahead and a reserved pickup time; it isn’t charged at the counter.</p>
      {unapproved && <p className="note warn">Test pricing: the tax treatment of this fee hasn’t been approved yet.</p>}
    </div>
  );
}

// ---------- order tracking ----------
const FLOW: OrderStatus[] = ['AWAITING_VENDOR', 'ACCEPTED', 'PREPARING', 'READY', 'COLLECTED'];
const END_BAD: OrderStatus[] = ['REJECTED', 'CANCELLED', 'EXPIRED', 'NOT_COLLECTED'];
const STEP_LABEL: Record<string, string> = { AWAITING_VENDOR: 'Sent to the shop', ACCEPTED: 'Confirmed by the shop', PREPARING: 'Being prepared', READY: 'Ready for pickup', COLLECTED: 'Collected' };
const HEADLINE: Partial<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: 'Waiting for payment',
  AWAITING_VENDOR: 'Waiting for the shop to confirm',
  ACCEPTED: 'Your order is confirmed',
  PREPARING: 'Your food is being prepared',
  READY: 'Ready to collect',
  COLLECTED: 'Collected. Enjoy your meal',
  REJECTED: 'The shop couldn’t take this order',
  CANCELLED: 'Order cancelled',
  EXPIRED: 'This order expired',
  NOT_COLLECTED: 'Marked as not collected',
};
const pillTone = (s: OrderStatus) => (s === 'READY' || s === 'COLLECTED' ? 'good' : END_BAD.includes(s) ? 'bad' : s === 'PENDING_PAYMENT' ? 'warn' : 'live');

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

type OrderData = { order: OrderView; events: { status: OrderStatus; reason: string | null; at: string }[]; refunds: { amountPaise: number; status: string }[] };

function OrderPage({ orderId }: { orderId: string }) {
  const [data, setData] = useState<OrderData | null>(null);
  const [err, setErr] = useState('');
  const [help, setHelp] = useState(false);
  const [helpText, setHelpText] = useState('');
  const [sent, setSent] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const load = useCallback(() => { api.get<OrderData>(`/orders/${orderId}`).then(setData).catch((e) => setErr(errMsg(e))); }, [orderId]);
  useEffect(load, [load]);
  useOrderLive(orderId, load);

  if (err && !data) return <><Back href="#/orders">Orders</Back><Alert tone="error">{err}</Alert></>;
  if (!data) return <p className="loading">Loading order…</p>;
  const { order, events } = data;
  const idx = FLOW.indexOf(order.status);
  const bad = END_BAD.includes(order.status);
  const cancellable = order.status === 'PENDING_PAYMENT' || order.status === 'AWAITING_VENDOR';
  const showTicket = !!order.pickupCode && !bad && order.status !== 'PENDING_PAYMENT';
  const reachedAt = (s: OrderStatus) => [...events].reverse().find((e) => e.status === s)?.at;
  const lastReason = events.at(-1)?.reason;
  const window_ = `${fmtTime(order.slotStartsAt)} – ${fmtTime(order.slotEndsAt)}`;

  const sub =
    order.status === 'READY' ? `Head to ${order.shopName} and show your code at the counter.`
    : order.status === 'PREPARING' || order.status === 'ACCEPTED' ? `Pickup ${window_} at ${order.shopName}.`
    : order.status === 'AWAITING_VENDOR' ? `${order.shopName} usually confirms within a couple of minutes. If they can’t, you’re refunded in full.`
    : order.status === 'PENDING_PAYMENT' ? 'We’ll update this page as soon as the payment is confirmed.'
    : bad ? (lastReason ? `Reason: ${lastReason}` : 'Any payment for this order is refunded in full.') : '';

  return (
    <>
      <Back href="#/orders">Orders</Back>
      <div className="status-head">
        <span className={`pill ${pillTone(order.status)}`}>{ORDER_STATUS_LABEL[order.status]}</span>
        <h1 style={{ marginTop: 10 }}>{HEADLINE[order.status] ?? ORDER_STATUS_LABEL[order.status]}</h1>
        {sub && <p>{sub}</p>}
      </div>

      {showTicket && (
        <div className={'ticket' + (order.status === 'READY' ? ' ready' : order.status === 'COLLECTED' ? ' done' : '')} aria-label="Pickup ticket">
          <div className="ticket-top">
            <div className="label">{order.status === 'READY' ? 'Ready now. Show this code' : 'Pickup code'}</div>
            <div className="ticket-code" aria-label={`Pickup code ${order.pickupCode!.split('').join(' ')}`}>{order.pickupCode}</div>
            <div className="hint">The shop asks for this code before handing over your food.</div>
          </div>
          <div className="ticket-bottom">
            <span className="k">Shop</span><span className="k">Pickup</span>
            <span className="v">{order.shopName}</span><span className="v">{window_}</span>
            <span className="k" style={{ marginTop: 8 }}>Order</span><span />
            <span className="v">{order.orderNumber}</span><span />
          </div>
        </div>
      )}

      {order.status === 'PENDING_PAYMENT' && <div style={{ marginTop: 18 }}><Alert tone="warn">Payment not confirmed yet. If you closed the payment screen, go back to checkout to finish it.</Alert><a className="btn block" style={{ marginTop: 10 }} href="#/checkout">Back to checkout</a></div>}

      {!bad && order.status !== 'PENDING_PAYMENT' && (
        <section className="section">
          <h2>Progress</h2>
          <ol className="steps" aria-label="Order progress">
            {FLOW.map((s, i) => {
              const done = i < idx || order.status === 'COLLECTED';
              const current = i === idx && order.status !== 'COLLECTED';
              const at = reachedAt(s);
              return (
                <li key={s} className={done ? 'done' : current ? 'current' : ''} aria-current={current ? 'step' : undefined}>
                  <span className="dot">{done ? Icon.check : null}</span>
                  <span>{STEP_LABEL[s]}</span>
                  {at && (done || current) ? <time dateTime={at}>{fmtTime(at)}</time> : <span />}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2>Receipt</h2><span className="small sub">{order.orderNumber}</span></div>
        <div className="summary">
          {order.items.map((i) => <div className="line" key={i.menuItemId}><span>{i.quantity}× {i.name}</span><span>{formatPaise(i.lineTotalPaise)}</span></div>)}
          <div className="line minor"><span>QuickPick fee ({order.feeRateBps / 100}%)</span><span>{formatPaise(order.feePaise)}</span></div>
          {order.taxPaise > 0 && <div className="line minor"><span>Tax</span><span>{formatPaise(order.taxPaise)}</span></div>}
          <div className="line total"><span>Total</span><span>{formatPaise(order.totalPaise)}</span></div>
          <div className="line minor" style={{ marginTop: 6 }}><span>Payment</span><span>{PAYMENT_STATUS_LABEL[order.paymentStatus as PaymentStatus]}</span></div>
          {data.refunds.map((r, i) => (
            <div className="line minor" key={i}><span>{r.status === 'PROCESSED' ? 'Refunded' : 'Refund in progress'}</span><span>{formatPaise(r.amountPaise)}</span></div>
          ))}
        </div>
      </section>

      {err && <div style={{ marginTop: 16 }}><Alert tone="error">{err}</Alert></div>}

      <div className="order-actions">
        {cancellable && !confirmCancel && <button className="btn danger block" onClick={() => setConfirmCancel(true)}>Cancel order</button>}
        {cancellable && confirmCancel && (
          <div className="dialog" role="alertdialog" aria-labelledby="cancel-title" style={{ marginTop: 0 }}>
            <h2 id="cancel-title">Cancel this order?</h2>
            <p className="sub" style={{ marginTop: 6 }}>{order.paymentStatus === 'SUCCEEDED' ? `You’ll be refunded ${formatPaise(order.totalPaise)} in full.` : 'Your pickup time will be released.'}</p>
            <div className="actions">
              <button className="btn" onClick={() => setConfirmCancel(false)}>Keep order</button>
              <button className="btn danger" onClick={async () => { try { await api.post(`/orders/${orderId}/cancel`); setConfirmCancel(false); load(); } catch (e) { setErr(errMsg(e)); } }}>Cancel order</button>
            </div>
          </div>
        )}
        {sent ? <Alert tone="good">Report sent. The QuickPick team will look into it and contact you.</Alert> : !help ? (
          <button className="btn quiet block" onClick={() => setHelp(true)}>Report a problem with this order</button>
        ) : (
          <div className="dialog support" style={{ marginTop: 0 }}>
            <div className="field"><label htmlFor="help">What went wrong?</label><textarea id="help" rows={3} value={helpText} onChange={(e) => setHelpText(e.target.value)} placeholder="For example: an item was missing" /></div>
            <div className="actions">
              <button className="btn" onClick={() => setHelp(false)}>Close</button>
              <button className="btn primary" disabled={!helpText.trim()} onClick={async () => { try { await api.post(`/orders/${orderId}/support`, { category: 'Order issue', description: helpText }); setSent(true); } catch (e) { setErr(errMsg(e)); } }}>Send report</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ---------- history ----------
function History() {
  const [orders, setOrders] = useState<OrderView[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get<{ orders: OrderView[] }>('/me/orders').then((r) => setOrders(r.orders)).catch((e) => { setErr(errMsg(e)); setOrders([]); }); }, []);
  if (!orders) return <p className="loading">Loading your orders…</p>;
  return (
    <>
      <div className="page-head"><h1>Your orders</h1></div>
      {err && <Alert tone="error">{err}</Alert>}
      {orders.length === 0 && !err && <div className="empty"><h2>No orders yet</h2><p>Your current and past orders will appear here.</p><a className="btn primary" href="#/">Browse shops</a></div>}
      {orders.length > 0 && (
        <ul className="list">
          {orders.map((o) => (
            <li key={o.id}>
              <a className="row-link order-row" href={`#/order/${o.id}`}>
                <span className="grow">
                  <span className="row-title"><h2>{o.shopName}</h2><span className="total">{formatPaise(o.totalPaise)}</span></span>
                  <span className="row-meta" style={{ alignItems: 'center' }}>
                    <span className={`pill ${pillTone(o.status)}`}>{ORDER_STATUS_LABEL[o.status]}</span>
                    <span>{fmtDay(o.slotStartsAt)}, {fmtTime(o.slotStartsAt)}</span>
                    <span>{o.orderNumber}</span>
                  </span>
                </span>
                {Icon.chevronRight}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
