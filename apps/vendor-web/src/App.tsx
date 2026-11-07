import { ApiError, ORDER_STATUS_LABEL, createApiClient, formatPaise, type OrderStatus, type OrderView } from '@quickpick/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const api = createApiClient({ baseUrl: API_URL, tokenKey: 'qp_vendor_token', onUnauthorized: () => window.dispatchEvent(new Event('qp-logout')) });

interface ShopInfo { shop: { id: string; name: string; acceptingOrders: boolean; acceptTimeoutSeconds: number }; menu: { id: string; name: string; basePricePaise: number; available: boolean }[] }

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

// ---------- sound (browsers need one tap to allow audio) ----------
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

export function App() {
  const [authed, setAuthed] = useState(!!api.getToken());
  useEffect(() => {
    const on = () => { api.clearToken(); setAuthed(false); };
    window.addEventListener('qp-logout', on);
    return () => window.removeEventListener('qp-logout', on);
  }, []);
  return (
    <>
      <div className="sandbox-banner">SANDBOX — test orders only</div>
      {authed ? <Dashboard onLogout={() => { api.clearToken(); setAuthed(false); }} /> : <Login onDone={() => setAuthed(true)} />}
    </>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    try { const r = await api.post<{ token: string; user: { role: string } }>('/auth/login', { email, password }); if (r.user.role !== 'VENDOR') { setErr('This sign-in is for shop accounts only.'); return; } api.setToken(r.token); onDone(); }
    catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div className="login stack">
      <h1>☕ QuickPick Vendor</h1>
      <div className="card stack">
        <div className="field"><label htmlFor="e">Shop email</label><input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></div>
        <div className="field"><label htmlFor="p">Password</label><input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && submit()} /></div>
        {err && <div className="error" role="alert">{err}</div>}
        <button className="primary" onClick={submit}>Sign in</button>
      </div>
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
  const seen = useRef<Set<string> | null>(null);
  const soundRef = useRef(false);
  soundRef.current = soundOn;

  // Source of truth is always the REST endpoint: called on load, on every socket signal, on reconnect, and every 8 s.
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

  if (!info) return <div className="page"><p className="muted">Loading…</p>{!online && <div className="error">Cannot reach the server. Retrying…</div>}</div>;

  const by = (s: OrderStatus) => orders.filter((o) => o.status === s);
  const connected = online && socketUp;
  const newOrders = by('AWAITING_VENDOR');
  const paused = !info.shop.acceptingOrders;

  const togglePause = async () => {
    try { await api.patch('/vendor/shop/status', { acceptingOrders: paused }); await refresh(); } catch (e) { setErr(errMsg(e)); }
  };

  return (
    <div className="vapp">
      <div className="vtop">
        <h1>{info.shop.name}</h1>
        <span className={'pill ' + (connected ? 'on' : 'off')}>{connected ? '● Online' : online ? '● Reconnecting…' : '● Offline'}</span>
        <span className={'pill ' + (paused ? 'paused' : 'on')}>{paused ? 'Orders PAUSED' : 'Taking orders'}</span>
        <button onClick={togglePause}>{paused ? 'Resume orders' : 'Pause new orders'}</button>
        <button onClick={onLogout}>Sign out</button>
      </div>
      {!soundOn && <div className="alert-bar"><span>🔔 Tap to turn on sound alerts for new orders</span><button className="primary" onClick={() => { enableAudio(); setSoundOn(true); }}>Enable sound</button></div>}
      {!connected && <div className="error" style={{ margin: 12 }}>{online ? 'Live updates are reconnecting. Orders still refresh every few seconds.' : 'No internet. Orders shown may be out of date — check the Wi-Fi.'}</div>}
      {err && <div className="error" style={{ margin: 12 }} role="alert" onClick={() => setErr('')}>{err} (tap to dismiss)</div>}
      <div className="tabs" role="tablist">
        {([['orders', `Orders${newOrders.length ? ` (${newOrders.length} new)` : ''}`], ['menu', 'Menu availability'], ['today', 'Today']] as const).map(([k, label]) => (
          <button key={k} role="tab" className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'orders' && (
        <div className="board">
          {([['AWAITING_VENDOR', 'New', 'new'], ['ACCEPTED', 'Accepted', ''], ['PREPARING', 'Preparing', ''], ['READY', 'Ready', '']] as const).map(([s, label, cls]) => (
            <div key={s} className={'col ' + cls}>
              <h2>{label}<span className="count">{by(s).length}</span></h2>
              {by(s).length === 0 && <div className="empty small">None</div>}
              {by(s).map((o) => <OrderCard key={o.id} o={o} now={now} onDone={refresh} onError={setErr} />)}
            </div>
          ))}
        </div>
      )}
      {tab === 'menu' && <MenuTab info={info} onChange={refresh} onError={setErr} />}
      {tab === 'today' && <Today orders={orders} />}
    </div>
  );
}

function OrderCard({ o, now, onDone, onError }: { o: OrderView; now: number; onDone: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [prep, setPrep] = useState(10);
  const [code, setCode] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('Out of stock');

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); onError(''); try { await fn(); await onDone(); } catch (e) { onError(errMsg(e)); } finally { setBusy(false); } };
  const status = (s: string, body: object = {}) => run(() => api.patch(`/vendor/orders/${o.id}/status`, { status: s, ...body }));
  const left = o.acceptDeadline ? Math.max(0, Math.round((new Date(o.acceptDeadline).getTime() - now) / 1000)) : null;

  return (
    <div className={'card ocard s-' + o.status}>
      <div className="row between"><span className="onum">{o.orderNumber}</span><span className="badge ok">Paid</span></div>
      <div className="row between muted"><span>Pickup <b>{fmtTime(o.slotStartsAt)}</b></span><span>{o.customerName}</span></div>
      <ul className="items">{o.items.map((i) => <li key={i.menuItemId}>{i.quantity} × {i.name}</li>)}</ul>
      <div className="row between small muted"><span>Food value {formatPaise(o.subtotalPaise)}</span>{o.prepMinutes && <span>Prep ~{o.prepMinutes} min</span>}</div>

      {o.status === 'AWAITING_VENDOR' && left !== null && <p className={'timer' + (left <= 20 ? ' low' : '')}>Respond within {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} or it auto-cancels with a refund</p>}

      <div className="actions">
        {o.status === 'AWAITING_VENDOR' && !rejecting && (
          <>
            <div className="row"><label htmlFor={'p' + o.id} style={{ margin: 0 }}>Prep time</label>
              <select id={'p' + o.id} value={prep} onChange={(e) => setPrep(Number(e.target.value))}>{[5, 8, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m} min</option>)}</select></div>
            <div className="two"><button className="ok" disabled={busy} onClick={() => run(() => api.post(`/vendor/orders/${o.id}/accept`, { prepMinutes: prep }))}>Accept</button><button className="danger" disabled={busy} onClick={() => setRejecting(true)}>Reject</button></div>
          </>
        )}
        {o.status === 'AWAITING_VENDOR' && rejecting && (
          <>
            <select aria-label="Reject reason" value={reason} onChange={(e) => setReason(e.target.value)}>{['Out of stock', 'Too busy', 'Shop closing', 'Other'].map((r) => <option key={r}>{r}</option>)}</select>
            <div className="two"><button className="danger" disabled={busy} onClick={() => run(() => api.post(`/vendor/orders/${o.id}/reject`, { reason }))}>Confirm reject (refunds)</button><button onClick={() => setRejecting(false)}>Back</button></div>
          </>
        )}
        {o.status === 'ACCEPTED' && <button className="primary" disabled={busy} onClick={() => status('PREPARING')}>Start preparing</button>}
        {o.status === 'PREPARING' && <button className="primary" disabled={busy} onClick={() => status('READY')}>Mark ready</button>}
        {o.status === 'READY' && (
          <>
            <div className="field"><label htmlFor={'c' + o.id}>Customer’s 4-digit pickup code</label><input id={'c' + o.id} inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
            <div className="two"><button className="ok" disabled={busy || code.length !== 4} onClick={() => status('COLLECTED', { pickupCode: code })}>Handed over</button><button disabled={busy} onClick={() => status('NOT_COLLECTED')}>No-show</button></div>
          </>
        )}
        {(o.status === 'ACCEPTED' || o.status === 'PREPARING') && <button className="danger small" disabled={busy} onClick={() => { if (window.confirm('Cancel this paid order? The student will be refunded.')) void status('CANCELLED', { reason: 'Shop could not fulfil' }); }}>Can’t make it — cancel & refund</button>}
      </div>
    </div>
  );
}

function MenuTab({ info, onChange, onError }: { info: ShopInfo; onChange: () => void; onError: (m: string) => void }) {
  const toggle = async (id: string, available: boolean) => { try { await api.patch(`/vendor/menu-items/${id}`, { available }); onChange(); } catch (e) { onError(errMsg(e)); } };
  return (
    <div className="page"><div className="card">
      <h2>Menu availability</h2><p className="muted small">Mark items unavailable when you run out. Students can’t order them.</p>
      {info.menu.map((m) => (
        <div key={m.id} className="menu-row"><div><b>{m.name}</b><div className="muted small">{formatPaise(m.basePricePaise)}</div></div>
          <button className={m.available ? 'ok' : 'danger'} onClick={() => toggle(m.id, !m.available)}>{m.available ? 'Available' : 'Sold out'}</button></div>
      ))}
    </div></div>
  );
}

function Today({ orders }: { orders: OrderView[] }) {
  const [sum, setSum] = useState<{ collectedOrders: number; notFulfilled: number; foodValuePaise: number } | null>(null);
  const [days, setDays] = useState<{ day: string; orders: number; entitlementPaise: number }[]>([]);
  useEffect(() => { api.get<any>('/vendor/summary').then(setSum).catch(() => undefined); api.get<any>('/vendor/settlements').then((r) => setDays(r.days)).catch(() => undefined); }, [orders]);
  const done = orders.filter((o) => !['AWAITING_VENDOR', 'ACCEPTED', 'PREPARING', 'READY'].includes(o.status));
  return (
    <div className="stack" style={{ paddingTop: 12 }}>
      <div className="summary">
        <div className="card"><div className="big">{sum?.collectedOrders ?? '–'}</div>Collected today</div>
        <div className="card"><div className="big">{sum ? formatPaise(sum.foodValuePaise) : '–'}</div>Food value collected</div>
        <div className="card"><div className="big">{sum?.notFulfilled ?? '–'}</div>Not fulfilled</div>
      </div>
      <div className="page"><div className="card table-wrap"><h3>Finished orders</h3>
        <table><thead><tr><th>Order</th><th>Pickup</th><th>Status</th><th>Items</th></tr></thead><tbody>
          {done.length === 0 && <tr><td colSpan={4} className="muted">Nothing finished yet.</td></tr>}
          {done.map((o) => <tr key={o.id}><td>{o.orderNumber}</td><td>{fmtTime(o.slotStartsAt)}</td><td>{ORDER_STATUS_LABEL[o.status]}</td><td>{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</td></tr>)}
        </tbody></table></div>
        <div className="card table-wrap" style={{ marginTop: 12 }}><h3>Planned settlement (sandbox)</h3><p className="muted small">Your entitlement is the original menu price. No real settlement has happened.</p>
          <table><thead><tr><th>Day</th><th>Orders</th><th>Entitlement</th></tr></thead><tbody>{days.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.orders}</td><td>{formatPaise(d.entitlementPaise)}</td></tr>)}</tbody></table></div>
      </div>
    </div>
  );
}
