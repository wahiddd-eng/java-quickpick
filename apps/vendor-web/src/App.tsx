import { ApiError, ORDER_STATUS_LABEL, createApiClient, formatPaise, type OrderStatus, type OrderView } from '@quickpick/shared';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const api = createApiClient({ baseUrl: API_URL, tokenKey: 'qp_vendor_token', onUnauthorized: () => window.dispatchEvent(new Event('qp-logout')) });

interface ShopInfo { shop: { id: string; name: string; acceptingOrders: boolean; acceptTimeoutSeconds: number }; menu: { id: string; name: string; basePricePaise: number; available: boolean }[] }

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Couldn’t reach QuickPick. Check the Wi-Fi and try again.');
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
const PREP_CHOICES = [5, 10, 15, 20, 30];
const REJECT_REASONS = ['Out of stock', 'Too busy', 'Closing soon', 'Other'];

// ---------- sound (browsers need one tap before they allow audio) ----------
let audioCtx: AudioContext | null = null;
function enableAudio() {
  audioCtx = audioCtx ?? new AudioContext();
  void audioCtx.resume();
  beep(1);
}
function beep(times = 3) {
  if (!audioCtx) return;
  const ctx = audioCtx;
  for (let i = 0; i < times; i++) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = i % 2 ? 880 : 1175;
    g.gain.value = 0.15;
    o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime + i * 0.25;
    o.start(t); o.stop(t + 0.18);
  }
}

const Bell = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>;
const Cup = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 9h13v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6V9Z" /><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17" /><path d="M8 3v3M12 3v3" /></svg>;

export function App() {
  const [authed, setAuthed] = useState(!!api.getToken());
  useEffect(() => {
    const on = () => { api.clearToken(); setAuthed(false); };
    window.addEventListener('qp-logout', on);
    return () => window.removeEventListener('qp-logout', on);
  }, []);
  return (
    <>
      <div className="sandbox-banner">Test mode: these are test orders and no real money is involved</div>
      {authed ? <Dashboard onLogout={() => { api.clearToken(); setAuthed(false); }} /> : <Login onDone={() => setAuthed(true)} />}
    </>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await api.post<{ token: string; user: { role: string } }>('/auth/login', { email, password });
      if (r.user.role !== 'VENDOR') { setErr('This sign-in is for shop accounts. Use the admin console instead.'); return; }
      api.setToken(r.token); onDone();
    } catch (er) { setErr(errMsg(er)); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><span className="mark"><Cup /></span><div><b>QuickPick</b><span>Shop tablet</span></div></div>
        <h1>Sign in to your shop</h1>
        <div className="field"><label htmlFor="e">Shop email</label><input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></div>
        <div className="field"><label htmlFor="p">Password</label><input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
        {err && <div className="error" role="alert">{err}</div>}
        <button className="big primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small">Stay signed in on this tablet. Ask the QuickPick team if you’ve lost the password.</p>
      </form>
    </div>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [info, setInfo] = useState<ShopInfo | null>(null);
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [tab, setTab] = useState<'orders' | 'menu' | 'today'>('orders');
  const [online, setOnline] = useState(true);
  const [socketUp, setSocketUp] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(Date.now());
  const [handover, setHandover] = useState<OrderView | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const soundRef = useRef(false);
  soundRef.current = soundOn;

  // The REST endpoint is the source of truth: called on load, on every socket signal, on reconnect and every 8 s.
  const refresh = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([api.get<{ orders: OrderView[] }>('/vendor/orders'), api.get<ShopInfo>('/vendor/shop')]);
      setOrders(o.orders); setInfo(s); setOnline(true);
      const newIds = o.orders.filter((x) => x.status === 'AWAITING_VENDOR').map((x) => x.id);
      if (seen.current === null) seen.current = new Set(newIds);
      else if (newIds.some((id) => !seen.current!.has(id))) { if (soundRef.current) beep(4); newIds.forEach((id) => seen.current!.add(id)); }
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setOnline(false); else setErr(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(refresh, 8000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const beat = setInterval(() => { api.post('/vendor/heartbeat').catch(() => undefined); }, 30000);
    api.post('/vendor/heartbeat').catch(() => undefined);
    const token = api.getToken();
    const socket = io(API_URL, { auth: { token }, transports: ['websocket', 'polling'] });
    socket.on('connect', () => { setSocketUp(true); void refresh(); });
    socket.on('disconnect', () => setSocketUp(false));
    socket.on('order', () => { void refresh(); });
    window.addEventListener('online', refresh);
    return () => { clearInterval(poll); clearInterval(tick); clearInterval(beat); socket.close(); window.removeEventListener('online', refresh); };
  }, [refresh]);

  if (!info) return <div className="loading-screen"><p>Loading orders…</p>{!online && <div className="error">Can’t reach QuickPick. Retrying every few seconds.</div>}</div>;

  const by = (s: OrderStatus) => orders.filter((o) => o.status === s);
  const connected = online && socketUp;
  const newCount = by('AWAITING_VENDOR').length;
  const paused = !info.shop.acceptingOrders;

  const togglePause = async () => {
    try { await api.patch('/vendor/shop/status', { acceptingOrders: paused }); await refresh(); } catch (e) { setErr(errMsg(e)); }
  };

  const COLUMNS: [OrderStatus, string, string, string][] = [
    ['AWAITING_VENDOR', 'New', 'new', 'Accept or reject'],
    ['ACCEPTED', 'Accepted', 'accepted', 'Start when ready'],
    ['PREPARING', 'Preparing', 'preparing', 'Mark ready when done'],
    ['READY', 'Ready', 'ready', 'Waiting for pickup'],
  ];

  return (
    <div className="vapp">
      <header className="vtop">
        <div className="vtop-shop">
          <h1>{info.shop.name}</h1>
          <span className={'conn ' + (connected ? 'live' : online ? 'slow' : 'down')}><span className="dot" />{connected ? 'Live' : online ? 'Reconnecting' : 'Offline'}</span>
        </div>
        <div className="vtop-actions">
          <button className={'sound ' + (soundOn ? 'on' : '')} onClick={() => { if (!soundOn) { enableAudio(); setSoundOn(true); } else beep(1); }} aria-label={soundOn ? 'Sound is on. Tap to test' : 'Turn on sound'}>
            <Bell />{soundOn ? 'Sound on' : 'Sound off'}
          </button>
          <button className={'switch ' + (paused ? 'off' : 'on')} role="switch" aria-checked={!paused} onClick={togglePause}>
            <span className="track"><span className="knob" /></span>
            <span>{paused ? 'Orders paused' : 'Taking orders'}</span>
          </button>
          {!confirmSignOut ? <button className="ghost" onClick={() => setConfirmSignOut(true)}>Sign out</button> : (
            <span className="confirm-inline"><span>Sign out of this tablet?</span><button className="ghost" onClick={() => setConfirmSignOut(false)}>No</button><button className="danger-solid" onClick={onLogout}>Sign out</button></span>
          )}
        </div>
      </header>

      {!soundOn && (
        <div className="banner warn">
          <span><b>Sound is off.</b> You won’t hear new orders arrive.</span>
          <button className="big primary" onClick={() => { enableAudio(); setSoundOn(true); }}><Bell />Turn on sound</button>
        </div>
      )}
      {paused && <div className="banner paused"><span><b>New orders are paused.</b> Students can’t order from you until you turn orders back on. Orders already placed still need finishing.</span><button className="big" onClick={togglePause}>Start taking orders</button></div>}
      {!connected && <div className="banner bad"><span>{online ? <><b>Live updates are reconnecting.</b> The board still refreshes every few seconds.</> : <><b>No internet.</b> This board may be out of date. Check the Wi-Fi or switch to a hotspot.</>}</span></div>}
      {err && <div className="banner bad" role="alert"><span>{err}</span><button className="ghost-dark" onClick={() => setErr('')}>Dismiss</button></div>}

      <nav className="tabs" role="tablist" aria-label="Sections">
        <button role="tab" aria-selected={tab === 'orders'} onClick={() => setTab('orders')}>Orders{newCount > 0 && <span className="tab-count">{newCount} new</span>}</button>
        <button role="tab" aria-selected={tab === 'menu'} onClick={() => setTab('menu')}>Menu</button>
        <button role="tab" aria-selected={tab === 'today'} onClick={() => setTab('today')}>Today</button>
      </nav>

      {tab === 'orders' && (
        <div className="board">
          {COLUMNS.map(([s, label, cls, hint]) => (
            <section key={s} className={'col ' + cls} aria-label={label}>
              <div className="col-head"><h2>{label}</h2><span className="count">{by(s).length}</span></div>
              {by(s).length === 0 && <div className="col-empty">{s === 'AWAITING_VENDOR' ? (paused ? 'Paused — no new orders' : 'No new orders') : hint}</div>}
              {by(s).map((o) => <OrderCard key={o.id} o={o} now={now} timeout={info.shop.acceptTimeoutSeconds} onDone={refresh} onError={setErr} onHandover={() => setHandover(o)} />)}
            </section>
          ))}
        </div>
      )}
      {tab === 'menu' && <MenuTab info={info} onChange={refresh} onError={setErr} />}
      {tab === 'today' && <Today orders={orders} />}

      {handover && <HandoverSheet o={handover} onClose={() => setHandover(null)} onDone={() => { setHandover(null); void refresh(); }} />}
    </div>
  );
}

function OrderCard({ o, now, timeout, onDone, onError, onHandover }: { o: OrderView; now: number; timeout: number; onDone: () => void; onError: (m: string) => void; onHandover: () => void }) {
  const [busy, setBusy] = useState(false);
  const [prep, setPrep] = useState(10);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); onError(''); try { await fn(); await onDone(); } catch (e) { onError(errMsg(e)); } finally { setBusy(false); } };
  const status = (s: string, body: object = {}) => run(() => api.patch(`/vendor/orders/${o.id}/status`, { status: s, ...body }));
  const left = o.acceptDeadline ? Math.max(0, Math.round((new Date(o.acceptDeadline).getTime() - now) / 1000)) : null;
  const pct = left !== null && timeout > 0 ? Math.min(100, (left / timeout) * 100) : 0;
  const itemCount = o.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <article className={'ocard s-' + o.status}>
      {o.status === 'AWAITING_VENDOR' && left !== null && (
        <div className={'countdown' + (left <= 20 ? ' low' : '')} aria-live="off">
          <div className="bar" style={{ width: `${pct}%` }} />
          <span>{left > 0 ? `Respond in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Time’s up — cancelling'}</span>
        </div>
      )}
      <div className="ohead">
        <div><div className="onum">{o.orderNumber}</div><div className="who">{o.customerName ?? 'Student'} · {itemCount} item{itemCount === 1 ? '' : 's'}</div></div>
        <div className="pickup"><span>Pickup</span><b>{fmtTime(o.slotStartsAt)}</b></div>
      </div>
      <ul className="items">{o.items.map((i) => <li key={i.menuItemId}><span className="q">{i.quantity}</span><span>{i.name}</span></li>)}</ul>
      {o.prepMinutes && o.status !== 'AWAITING_VENDOR' && <p className="meta">You said about {o.prepMinutes} min to prepare</p>}

      <div className="actions">
        {o.status === 'AWAITING_VENDOR' && !rejecting && (
          <>
            <div className="choose"><span className="choose-label">Minutes to prepare</span>
              <div className="chips" role="radiogroup" aria-label="Preparation time">
                {PREP_CHOICES.map((m) => <button key={m} role="radio" aria-checked={prep === m} className={prep === m ? 'sel' : ''} aria-label={`${m} minutes`} onClick={() => setPrep(m)}>{m}</button>)}
              </div>
            </div>
            <div className="two">
              <button className="big outline-bad" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
              <button className="big primary" disabled={busy} onClick={() => run(() => api.post(`/vendor/orders/${o.id}/accept`, { prepMinutes: prep }))}>Accept</button>
            </div>
          </>
        )}
        {o.status === 'AWAITING_VENDOR' && rejecting && (
          <>
            <div className="choose"><span className="choose-label">Why can’t you take it? The student gets a full refund.</span>
              <div className="chips wrap" role="radiogroup" aria-label="Reason">
                {REJECT_REASONS.map((r) => <button key={r} role="radio" aria-checked={reason === r} className={reason === r ? 'sel bad' : ''} onClick={() => setReason(r)}>{r}</button>)}
              </div>
            </div>
            <div className="two">
              <button className="big" onClick={() => { setRejecting(false); setReason(''); }}>Back</button>
              <button className="big danger-solid" disabled={busy || !reason} onClick={() => run(() => api.post(`/vendor/orders/${o.id}/reject`, { reason }))}>Reject</button>
            </div>
          </>
        )}
        {o.status === 'ACCEPTED' && <button className="big primary" disabled={busy} onClick={() => status('PREPARING')}>Start preparing</button>}
        {o.status === 'PREPARING' && <button className="big primary" disabled={busy} onClick={() => status('READY')}>Mark ready</button>}
        {o.status === 'READY' && (
          <div className="two">
            <button className="big" disabled={busy} onClick={() => status('NOT_COLLECTED')}>No-show</button>
            <button className="big primary" disabled={busy} onClick={onHandover}>Hand over</button>
          </div>
        )}
        {(o.status === 'ACCEPTED' || o.status === 'PREPARING') && (!cancelling ? (
          <button className="text-bad" onClick={() => setCancelling(true)}>Can’t make this order</button>
        ) : (
          <div className="confirm-box">
            <p><b>Cancel {o.orderNumber}?</b> The student is refunded in full.</p>
            <div className="two"><button className="big" onClick={() => setCancelling(false)}>Keep order</button><button className="big danger-solid" disabled={busy} onClick={() => status('CANCELLED', { reason: 'Shop could not fulfil' })}>Cancel and refund</button></div>
          </div>
        ))}
      </div>
    </article>
  );
}

// Full-screen keypad so the on-screen keyboard never covers the board.
function HandoverSheet({ o, onClose, onDone }: { o: OrderView; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const press = (k: string) => { setErr(''); setCode((c) => (k === 'del' ? c.slice(0, -1) : k === 'clr' ? '' : c.length < 4 ? c + k : c)); };
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); else if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  const submit = async () => {
    setBusy(true); setErr('');
    try { await api.patch(`/vendor/orders/${o.id}/status`, { status: 'COLLECTED', pickupCode: code }); onDone(); }
    catch (e) { setErr(e instanceof ApiError && e.status === 422 ? 'That code doesn’t match. Ask the student to check the code in their app.' : errMsg(e)); setCode(''); }
    finally { setBusy(false); }
  };
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="ho-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-head">
          <div><h2 id="ho-title">Hand over {o.orderNumber}</h2><p className="muted">{o.customerName ?? 'Student'} · {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</p></div>
          <button className="ghost-dark" onClick={onClose}>Close</button>
        </div>
        <p className="sheet-ask">Ask for the 4-digit pickup code</p>
        <div className={'code-boxes' + (err ? ' wrong' : '')} aria-label={`Entered ${code.length} of 4 digits`}>
          {[0, 1, 2, 3].map((i) => <span key={i} className={code[i] ? 'filled' : i === code.length ? 'next' : ''}>{code[i] ?? ''}</span>)}
        </div>
        {err && <div className="error" role="alert">{err}</div>}
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clr', '0', 'del'].map((k) => (
            <button key={k} className={k.length > 1 ? 'fn' : ''} onClick={() => press(k)} aria-label={k === 'del' ? 'Delete' : k === 'clr' ? 'Clear' : k}>{k === 'del' ? '⌫' : k === 'clr' ? 'Clear' : k}</button>
          ))}
        </div>
        <button className="big primary block" disabled={busy || code.length !== 4} onClick={submit}>{busy ? 'Checking…' : 'Confirm handover'}</button>
      </div>
    </div>
  );
}

function MenuTab({ info, onChange, onError }: { info: ShopInfo; onChange: () => void; onError: (m: string) => void }) {
  const toggle = async (id: string, available: boolean) => { try { await api.patch(`/vendor/menu-items/${id}`, { available }); onChange(); } catch (e) { onError(errMsg(e)); } };
  const soldOut = info.menu.filter((m) => !m.available).length;
  return (
    <div className="page">
      <div className="page-head"><h2>Menu</h2><p className="muted">Turn an item off when it runs out. Students can’t order it until you turn it back on.{soldOut > 0 && <> <b className="bad-text">{soldOut} sold out.</b></>}</p></div>
      <ul className="menu-list">
        {info.menu.map((m) => (
          <li key={m.id} className={m.available ? '' : 'off'}>
            <div><b>{m.name}</b><span className="num muted">{formatPaise(m.basePricePaise)}</span></div>
            <button className={'switch ' + (m.available ? 'on' : 'off')} role="switch" aria-checked={m.available} aria-label={`${m.name} available`} onClick={() => toggle(m.id, !m.available)}>
              <span>{m.available ? 'Available' : 'Sold out'}</span><span className="track"><span className="knob" /></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Today({ orders }: { orders: OrderView[] }) {
  const [sum, setSum] = useState<{ collectedOrders: number; notFulfilled: number; foodValuePaise: number } | null>(null);
  const [days, setDays] = useState<{ day: string; orders: number; entitlementPaise: number }[]>([]);
  useEffect(() => { api.get<any>('/vendor/summary').then(setSum).catch(() => undefined); api.get<any>('/vendor/settlements').then((r) => setDays(r.days)).catch(() => undefined); }, [orders]);
  const done = orders.filter((o) => !['AWAITING_VENDOR', 'ACCEPTED', 'PREPARING', 'READY'].includes(o.status));
  return (
    <div className="page">
      <div className="stats">
        <div className="stat"><span>Collected today</span><b className="num">{sum?.collectedOrders ?? '–'}</b></div>
        <div className="stat"><span>Food value collected</span><b className="num">{sum ? formatPaise(sum.foodValuePaise) : '–'}</b></div>
        <div className="stat"><span>Not fulfilled</span><b className="num">{sum?.notFulfilled ?? '–'}</b></div>
      </div>
      <section className="panel">
        <h2>Finished orders</h2>
        <div className="table-wrap"><table><thead><tr><th>Order</th><th>Pickup</th><th>Result</th><th>Items</th></tr></thead><tbody>
          {done.length === 0 && <tr><td colSpan={4} className="muted">Nothing finished yet today.</td></tr>}
          {done.map((o) => <tr key={o.id}><td><b>{o.orderNumber}</b></td><td className="num">{fmtTime(o.slotStartsAt)}</td><td><span className={'badge ' + (o.status === 'COLLECTED' ? 'ok' : 'bad')}>{ORDER_STATUS_LABEL[o.status]}</span></td><td>{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</td></tr>)}
        </tbody></table></div>
      </section>
      <section className="panel">
        <h2>What you’re owed</h2>
        <p className="muted small">You receive your full menu price for every collected order. This is test data; no real settlement has happened.</p>
        <div className="table-wrap"><table><thead><tr><th>Day</th><th>Orders</th><th>Amount</th></tr></thead><tbody>
          {days.length === 0 && <tr><td colSpan={3} className="muted">Nothing yet.</td></tr>}
          {days.map((d) => <tr key={d.day}><td>{d.day}</td><td className="num">{d.orders}</td><td className="num">{formatPaise(d.entitlementPaise)}</td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}
