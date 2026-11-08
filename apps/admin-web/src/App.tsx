import { ApiError, ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL, type PaymentStatus, createApiClient, formatPaise, type OrderStatus, type OrderView } from '@quickpick/shared';
import React, { useCallback, useRef, useEffect, useState, type ReactNode } from 'react';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const api = createApiClient({ baseUrl: API_URL, tokenKey: 'qp_admin_token', onUnauthorized: () => window.dispatchEvent(new Event('qp-logout')) });
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');
const dt = (s: string) => new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const cap = (s: string) => (s ? s[0] + s.slice(1).toLowerCase().replace(/_/g, ' ') : s);
const ostatus = (s: string) => ORDER_STATUS_LABEL[s as OrderStatus] ?? cap(s);
const pstatus = (s: string) => PAYMENT_STATUS_LABEL[s as PaymentStatus] ?? cap(s);
const rupeesToPaise = (v: string) => Math.round(parseFloat(v) * 100);

type Tab = 'overview' | 'orders' | 'shops' | 'menu' | 'vendors' | 'devices' | 'pricing' | 'payments' | 'support' | 'audit';
const TABS: [Tab, string][] = [['overview', 'Overview'], ['orders', 'Orders'], ['shops', 'Shops'], ['menu', 'Menus'], ['vendors', 'Vendors'], ['devices', 'Tablets'], ['pricing', 'Pricing'], ['payments', 'Payments & refunds'], ['support', 'Support'], ['audit', 'Audit log']];

export function App() {
  const [user, setUser] = useState<{ name: string; role: string } | null>(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    if (!api.getToken()) { setChecked(true); return; }
    api.get<{ user: { name: string; role: string } }>('/me').then((r) => setUser(r.user)).catch(() => api.clearToken()).finally(() => setChecked(true));
    const on = () => { api.clearToken(); setUser(null); };
    window.addEventListener('qp-logout', on);
    return () => window.removeEventListener('qp-logout', on);
  }, []);

  if (!checked) return <p className="muted" style={{ padding: 16 }}>Loading…</p>;
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) return <Login onDone={setUser} />;

  return (
    <>
      <div className="sandbox-banner">Test mode: real payments stay off until FSSAI, GST (CA), payment-provider and SRM approvals are in place</div>
      <div className="layout">
        <nav className="side" aria-label="Sections">
          <div className="brand"><span className="mark" aria-hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h13v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6V9Z" /><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17" /><path d="M8 3v3M12 3v3" /></svg></span><div><b>QuickPick</b><span>Admin console</span></div></div>
          <div className="side-links">{TABS.map(([k, label]) => <button key={k} className={tab === k ? 'active' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{label}</button>)}</div>
          <div className="side-foot">
            <div className="who"><b>{user.name}</b><span>{user.role === 'SUPER_ADMIN' ? 'Platform owner' : 'Admin'}</span></div>
            <button onClick={() => { api.clearToken(); setUser(null); }}>Sign out</button>
          </div>
        </nav>
        <main className="main">
          {tab === 'overview' && <Overview />}
          {tab === 'orders' && <Orders />}
          {tab === 'shops' && <Shops />}
          {tab === 'menu' && <Menus />}
          {tab === 'vendors' && <Vendors />}
          {tab === 'devices' && <Devices />}
          {tab === 'pricing' && <Pricing superAdmin={user.role === 'SUPER_ADMIN'} />}
          {tab === 'payments' && <Payments />}
          {tab === 'support' && <Support />}
          {tab === 'audit' && <Audit />}
        </main>
      </div>
    </>
  );
}

function Login({ onDone }: { onDone: (u: { name: string; role: string }) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErr('');
    try {
      const r = await api.post<{ token: string; user: { name: string; role: string } }>('/auth/login', { email, password });
      if (!['ADMIN', 'SUPER_ADMIN'].includes(r.user.role)) { setErr('This sign-in is for administrators only.'); return; }
      api.setToken(r.token); onDone(r.user);
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div className="admin-login">
      <form className="card stack" onSubmit={submit}>
        <div className="brand dark"><span className="mark" aria-hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h13v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6V9Z" /><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17" /><path d="M8 3v3M12 3v3" /></svg></span><div><b>QuickPick</b><span>Admin console</span></div></div>
        <h1>Sign in</h1>
        <div className="field"><label htmlFor="e">Email</label><input id="e" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="p">Password</label><input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {err && <div className="error" role="alert">{err}</div>}
        <button className="primary">Sign in</button>
      </form>
    </div>
  );
}

// ---------- helpers ----------
function useLoad<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const reload = useCallback(() => { api.get<T>(path).then((d) => { setData(d); setErr(''); }).catch((e) => setErr(errMsg(e))); }, [path]);
  useEffect(reload, [reload, ...deps]);
  return { data, err, reload };
}
const Section = ({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) => (
  <section className="card stack"><div className="section-head"><h2>{title}</h2>{right}</div>{children}</section>
);
const Err = ({ msg }: { msg: string }) => (msg ? <div className="error" role="alert">{msg}</div> : null);
const tone = (s: string) => (['COLLECTED', 'SUCCEEDED', 'REFUNDED', 'PROCESSED', 'ACTIVE', 'RESOLVED'].includes(s) ? 'ok' : ['REJECTED', 'CANCELLED', 'EXPIRED', 'FAILED', 'SUSPENDED', 'NOT_COLLECTED'].includes(s) ? 'bad' : 'warn');

// ---------- overview ----------
function Overview() {
  const { data, err } = useLoad<any>('/admin/analytics');
  const [csvErr, setCsvErr] = useState('');
  const download = async () => {
    try {
      const text = await api.text('/admin/export/orders.csv');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      a.download = `quickpick-orders-${data?.date ?? 'today'}.csv`;
      a.click();
    } catch (e) { setCsvErr(errMsg(e)); }
  };
  return (
    <Section title={`Today${data?.date ? `, ${data.date}` : ''}`} right={<button onClick={download}>Export today’s orders (CSV)</button>}>
      <Err msg={err || csvErr} />
      {data && (
        <div className="kpis">
          {[['Orders', data.orders], ['Paid orders', data.paidOrders], ['Food GMV', formatPaise(data.foodGmvPaise)], ['Gross QuickPick fees', formatPaise(data.grossFeePaise)], ['Cancelled / rejected', data.cancelledOrders], ['Refunded', data.refundedOrders], ['Active shops', data.activeShops]].map(([l, v]) => (
            <div className="kpi" key={String(l)}><span>{l}</span><b className="num">{v}</b></div>
          ))}
        </div>
      )}
      <p className="muted small">Gross fees are not profit: payment costs, taxes, refunds, hosting, tablets and support are not deducted. All figures are sandbox data.</p>
    </Section>
  );
}

// ---------- orders ----------
function Orders() {
  const [status, setStatus] = useState('');
  const { data, err, reload } = useLoad<{ orders: OrderView[] }>(`/admin/orders${status ? `?status=${status}` : ''}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Section title="Orders" right={<div className="row"><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"><option value="">All statuses</option>{Object.keys(ORDER_STATUS_LABEL).map((s) => <option key={s}>{s}</option>)}</select><button onClick={reload}>Refresh</button></div>}>
      <Err msg={err} />
      <div className="table-wrap"><table><thead><tr><th>Order</th><th>Shop</th><th>Status</th><th>Payment</th><th>Subtotal</th><th>Fee</th><th>Total</th><th>Pickup</th><th /></tr></thead><tbody>
        {data?.orders.map((o) => (
          <tr key={o.id}><td><b>{o.orderNumber}</b></td><td>{o.shopName}</td><td><span className={'badge ' + tone(o.status)}>{ostatus(o.status)}</span></td><td>{pstatus(o.paymentStatus)}</td><td className="price">{formatPaise(o.subtotalPaise)}</td><td className="price">{formatPaise(o.feePaise)}</td><td className="price">{formatPaise(o.totalPaise)}</td><td>{dt(o.slotStartsAt)}</td><td><button className="small" onClick={() => setOpen(open === o.id ? null : o.id)}>{open === o.id ? 'Hide' : 'Details'}</button></td></tr>
        ))}
        {data?.orders.length === 0 && <tr><td colSpan={9} className="muted">No orders.</td></tr>}
      </tbody></table></div>
      {open && <OrderDetail id={open} onChange={reload} />}
    </Section>
  );
}

function OrderDetail({ id, onChange }: { id: string; onChange: () => void }) {
  const { data, err, reload } = useLoad<any>(`/admin/orders/${id}`);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  if (!data) return <Err msg={err} />;
  const refund = async () => {
    setMsg('');
    try {
      await api.post('/admin/refunds', { orderId: id, reason, ...(amount ? { amountPaise: rupeesToPaise(amount) } : {}) }, { 'Idempotency-Key': crypto.randomUUID() });
      setAmount(''); setReason(''); reload(); onChange();
    } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <div className="card stack" style={{ background: 'var(--canvas)' }}>
      <h3>{data.order.orderNumber} timeline</h3>
      <ul className="timeline">{data.events.map((e: any, i: number) => <li key={i}><b>{ostatus(e.to)}</b> <span className="muted">{dt(e.at)}, by {cap(e.actor)}{e.reason ? `: ${e.reason}` : ''}</span></li>)}</ul>
      <div className="grid2">
        <div><h3>Fee breakdown</h3><p>Food {formatPaise(data.order.subtotalPaise)}<br />Fee ({data.order.feeRateBps / 100}%) {formatPaise(data.order.feePaise)}<br />Tax {formatPaise(data.order.taxPaise)}<br /><b>Total {formatPaise(data.order.totalPaise)}</b></p></div>
        <div><h3>Payments</h3>{data.payments.map((p: any) => <p key={p.id} className="small">{cap(p.provider)} <span className="mono">{p.providerRef}</span><br />{formatPaise(p.amountPaise)}, {pstatus(p.status)}</p>)}{data.payments.length === 0 && <p className="muted small">None</p>}</div>
        <div><h3>Planned split</h3>{data.splits.map((s: any) => <p key={s.beneficiary} className="small">{cap(s.beneficiary)}: {formatPaise(s.amountPaise)} <span className="muted">({cap(s.status)})</span></p>)}{data.splits.length === 0 && <p className="muted small">None</p>}</div>
        <div><h3>Refunds</h3>{data.refunds.map((r: any) => <p key={r.id} className="small">{formatPaise(r.amountPaise)}, {cap(r.status)}: {r.reason}</p>)}{data.refunds.length === 0 && <p className="muted small">None</p>}</div>
      </div>
      {['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(data.order.paymentStatus) && (
        <div className="row wrap"><input style={{ maxWidth: 140 }} placeholder="₹ (blank = all)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Refund amount in rupees" /><input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Refund reason" /><button className="danger" disabled={!reason.trim()} onClick={refund}>Issue refund</button></div>
      )}
      <Err msg={msg} />
    </div>
  );
}

// ---------- shops ----------
type ShopForm = { name: string; description: string; openTime: string; closeTime: string; slotMinutes: number; slotCapacity: number; acceptTimeoutSeconds: number; fssaiNumber: string; ownerContact: string; acceptingOrders: boolean; isDemo: boolean };
const BLANK_SHOP: ShopForm = { name: '', description: '', openTime: '11:30', closeTime: '15:00', slotMinutes: 10, slotCapacity: 5, acceptTimeoutSeconds: 90, fssaiNumber: '', ownerContact: '', acceptingOrders: true, isDemo: false };
const toForm = (s: any): ShopForm => ({ name: s.name ?? '', description: s.description ?? '', openTime: s.openTime, closeTime: s.closeTime, slotMinutes: s.slotMinutes, slotCapacity: s.slotCapacity, acceptTimeoutSeconds: s.acceptTimeoutSeconds, fssaiNumber: s.fssaiNumber ?? '', ownerContact: s.ownerContact ?? '', acceptingOrders: s.acceptingOrders, isDemo: s.isDemo });
const toApi = (f: ShopForm) => ({ ...f, name: f.name.trim(), description: f.description.trim(), fssaiNumber: f.fssaiNumber.trim() || null, ownerContact: f.ownerContact.trim() || null });
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock12 = (t: string) => { const h = Number(t.slice(0, 2)); const m = t.slice(3, 5); return `${h % 12 || 12}${m === '00' ? '' : ':' + m} ${h >= 12 ? 'pm' : 'am'}`; };
function hoursProblem(f: ShopForm): string {
  if (!/^\d{2}:\d{2}$/.test(f.openTime) || !/^\d{2}:\d{2}$/.test(f.closeTime)) return 'Enter both opening and closing times.';
  if (mins(f.closeTime) <= mins(f.openTime)) return 'Closing time must be after opening time.';
  if (mins(f.closeTime) - mins(f.openTime) < f.slotMinutes) return 'Opening hours must be at least one pickup slot long.';
  return '';
}
const SLOT_LENGTHS = [5, 10, 15, 20, 30, 45, 60];
const ACCEPT_TIMES = [30, 60, 90, 120, 180, 300];

function ShopFields({ f, set, editing }: { f: ShopForm; set: (f: ShopForm) => void; editing: boolean }) {
  const problem = hoursProblem(f);
  const count = problem ? 0 : Math.floor((mins(f.closeTime) - mins(f.openTime)) / f.slotMinutes);
  const lastStart = problem ? '' : (() => { const m = mins(f.openTime) + (count - 1) * f.slotMinutes; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; })();
  const id = editing ? 'e' : 'n';
  return (
    <>
      <div className="fs" role="group" aria-labelledby={id + '-details'}><h3 id={id + '-details'}>Shop details</h3><div className="grid2">
        <div className="field"><label htmlFor={id + 'name'}>Name</label><input id={id + 'name'} value={f.name} maxLength={100} onChange={(e) => set({ ...f, name: e.target.value })} /></div>
        <div className="field"><label htmlFor={id + 'desc'}>Description shown to students</label><input id={id + 'desc'} value={f.description} maxLength={500} placeholder="e.g. South Indian breakfast and meals" onChange={(e) => set({ ...f, description: e.target.value })} /></div>
        <div className="field"><label htmlFor={id + 'fssai'}>FSSAI number (as provided by the shop)</label><input id={id + 'fssai'} value={f.fssaiNumber} maxLength={40} onChange={(e) => set({ ...f, fssaiNumber: e.target.value })} /></div>
        <div className="field"><label htmlFor={id + 'contact'}>Owner contact (for QuickPick staff only)</label><input id={id + 'contact'} value={f.ownerContact} maxLength={200} placeholder="Name and phone" onChange={(e) => set({ ...f, ownerContact: e.target.value })} /></div>
      </div></div>

      <div className="fs" role="group" aria-labelledby={id + '-hours'}><h3 id={id + '-hours'}>Opening hours and pickup times (IST)</h3><div className="grid2">
        <div className="field"><label htmlFor={id + 'open'}>Opens</label><input id={id + 'open'} type="time" step={300} value={f.openTime} onChange={(e) => set({ ...f, openTime: e.target.value })} /></div>
        <div className="field"><label htmlFor={id + 'close'}>Closes</label><input id={id + 'close'} type="time" step={300} value={f.closeTime} onChange={(e) => set({ ...f, closeTime: e.target.value })} /></div>
        <div className="field"><label htmlFor={id + 'slot'}>Pickup slot length</label><select id={id + 'slot'} value={f.slotMinutes} onChange={(e) => set({ ...f, slotMinutes: Number(e.target.value) })}>{SLOT_LENGTHS.map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></div>
        <div className="field"><label htmlFor={id + 'cap'}>Orders per slot</label><input id={id + 'cap'} type="number" min={0} max={100} value={f.slotCapacity} onChange={(e) => set({ ...f, slotCapacity: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></div>
      </div>
        {problem ? <div className="error" role="alert">{problem}</div> : (
          <p className="preview">Students can choose from <b>{count} pickup time{count === 1 ? '' : 's'}</b>, every {f.slotMinutes} minutes from {clock12(f.openTime)} to {clock12(lastStart)}, with up to {f.slotCapacity} order{f.slotCapacity === 1 ? '' : 's'} each{f.slotCapacity === 0 ? ' (no orders can be placed)' : ''}.</p>
        )}
        {editing && <p className="muted small">Changing hours or slot length rebuilds today’s unbooked pickup times straight away. Orders already placed keep their time. Set capacity from measured kitchen throughput.</p>}
      </div>

      <div className="fs" role="group" aria-labelledby={id + '-orders'}><h3 id={id + '-orders'}>Orders</h3><div className="grid2">
        <div className="field narrow"><label htmlFor={id + 'acc'}>Time the shop has to accept a new order</label><select id={id + 'acc'} value={f.acceptTimeoutSeconds} onChange={(e) => set({ ...f, acceptTimeoutSeconds: Number(e.target.value) })}>{[...new Set([...ACCEPT_TIMES, f.acceptTimeoutSeconds])].sort((a, b) => a - b).map((t) => <option key={t} value={t}>{t < 60 ? `${t} seconds` : t % 60 ? `${Math.floor(t / 60)} min ${t % 60} s` : `${t / 60} minute${t === 60 ? '' : 's'}`}</option>)}</select></div>
      </div>
        <p className="muted small">If the shop doesn’t respond in time, the order is cancelled and the student refunded.</p>
        {editing && <label className="check"><input type="checkbox" checked={f.acceptingOrders} onChange={(e) => set({ ...f, acceptingOrders: e.target.checked })} /> Taking orders <span className="muted small">(the shop can also pause this from its tablet)</span></label>}
        <label className="check"><input type="checkbox" checked={f.isDemo} onChange={(e) => set({ ...f, isDemo: e.target.checked })} /> Demo shop <span className="muted small">(labelled as demo to students)</span></label>
      </div>
    </>
  );
}

function EditShop({ shop, onClose, onSaved }: { shop: any; onClose: () => void; onSaved: (name: string) => void }) {
  const original = toForm(shop);
  const [f, setF] = useState<ShopForm>(original);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, []);
  const a = toApi(f); const o = toApi(original);
  const changes = Object.fromEntries(Object.entries(a).filter(([k, v]) => v !== (o as any)[k]));
  const dirty = Object.keys(changes).length > 0;
  const save = async () => {
    setMsg('');
    if (!a.name) { setMsg('Give the shop a name.'); return; }
    const problem = hoursProblem(f); if (problem) { setMsg(problem); return; }
    setBusy(true);
    try { await api.patch(`/admin/shops/${shop.id}`, changes); onSaved(a.name); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div ref={ref}>
      <Section title={`Edit ${shop.name}`} right={<button onClick={onClose}>Close</button>}>
        <ShopFields f={f} set={setF} editing />
        <Err msg={msg} />
        <div className="row wrap form-actions">
          <button className="primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
          <button onClick={() => setF(original)} disabled={!dirty || busy}>Undo changes</button>
          {!dirty && <span className="muted small">No changes yet</span>}
        </div>
      </Section>
    </div>
  );
}

function Shops() {
  const { data, err, reload } = useLoad<{ shops: any[] }>('/admin/shops');
  const [form, setForm] = useState<ShopForm>(BLANK_SHOP);
  const [msg, setMsg] = useState('');
  const [saved, setSaved] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const create = async () => {
    setMsg(''); setSaved('');
    const problem = hoursProblem(form); if (problem) { setMsg(problem); return; }
    const { acceptingOrders: _a, ...body } = toApi(form);
    try { await api.post('/admin/shops', body); setSaved(`Created ${body.name}. It stays hidden from students until you activate it.`); setForm(BLANK_SHOP); reload(); } catch (e) { setMsg(errMsg(e)); }
  };
  const patch = async (id: string, body: object) => { setMsg(''); setSaved(''); try { await api.patch(`/admin/shops/${id}`, body); reload(); } catch (e) { setMsg(errMsg(e)); } };
  const editShop = data?.shops.find((s) => s.id === editing);
  return (
    <>
      <Section title="Shops"><Err msg={err || msg} />{saved && <div className="success" role="status">{saved}</div>}
        <div className="table-wrap"><table><thead><tr><th>Shop</th><th>Status</th><th>Hours (IST)</th><th>Pickup slots</th><th>Accept within</th><th>FSSAI</th><th /></tr></thead><tbody>
          {data?.shops.map((s) => (
            <tr key={s.id} className={editing === s.id ? 'selected' : ''}><td><b>{s.name}</b>{s.isDemo && <> <span className="badge info">demo</span></>}<div className="muted small">{s.description}</div></td><td><span className={'badge ' + tone(s.status)}>{cap(s.status)}</span>{!s.acceptingOrders && <> <span className="badge warn">paused</span></>}</td>
              <td className="num">{clock12(s.openTime)} – {clock12(s.closeTime)}</td><td>Every {s.slotMinutes} min, {s.slotCapacity} per slot</td><td>{s.acceptTimeoutSeconds}s</td><td>{s.fssaiNumber ?? <span className="muted">Not added</span>}</td>
              <td><div className="row wrap" style={{ justifyContent: 'flex-end' }}>
                <button className="small" onClick={() => { setSaved(''); setEditing(editing === s.id ? null : s.id); }} aria-expanded={editing === s.id}>{editing === s.id ? 'Close' : 'Edit'}</button>
                {s.status !== 'ACTIVE' && <button className="small ok" onClick={() => patch(s.id, { status: 'ACTIVE' })}>Activate</button>}
                {s.status === 'ACTIVE' && <button className="small danger" onClick={() => patch(s.id, { status: 'SUSPENDED' })}>Suspend</button>}
              </div></td></tr>
          ))}
        </tbody></table></div>
      </Section>
      {editShop && <EditShop key={editShop.id} shop={editShop} onClose={() => setEditing(null)} onSaved={(name) => { setEditing(null); setSaved(`Saved changes to ${name}.`); reload(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
      <Section title="Onboard a shop">
        <ShopFields f={form} set={setForm} editing={false} />
        <div className="row wrap form-actions"><button className="primary" disabled={!form.name.trim()} onClick={create}>Create shop</button><span className="muted small">New shops start as a draft, hidden from students until you activate them.</span></div>
      </Section>
    </>
  );
}

// ---------- menus ----------
function Menus() {
  const shops = useLoad<{ shops: any[] }>('/admin/shops');
  const [shopId, setShopId] = useState('');
  useEffect(() => { if (!shopId && shops.data?.shops[0]) setShopId(shops.data.shops[0].id); }, [shops.data, shopId]);
  const menu = useLoad<any>(shopId ? `/admin/shops/${shopId}/menu` : '/admin/shops', [shopId]);
  const [cat, setCat] = useState('');
  const [item, setItem] = useState({ name: '', price: '', categoryId: '' });
  const [msg, setMsg] = useState('');
  const isMenu = shopId && menu.data?.items;
  return (
    <Section title="Menus" right={<select value={shopId} onChange={(e) => setShopId(e.target.value)} aria-label="Shop">{shops.data?.shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}>
      <Err msg={msg || menu.err} />
      {isMenu && <div className="table-wrap"><table><thead><tr><th>Item</th><th>Price (₹)</th><th>Available</th></tr></thead><tbody>
        {menu.data.items.map((i: any) => (
          <tr key={i.id}><td>{i.name}</td><td><input style={{ width: 100, minHeight: 36 }} defaultValue={(i.basePricePaise / 100).toFixed(2)} inputMode="decimal" aria-label={`Price for ${i.name}`} onBlur={async (e) => { const p = rupeesToPaise(e.target.value); if (Number.isFinite(p) && p !== i.basePricePaise) { try { await api.patch(`/admin/menu-items/${i.id}`, { basePricePaise: p }); menu.reload(); } catch (er) { setMsg(errMsg(er)); } } }} /></td>
            <td><button className={'small ' + (i.available ? 'ok' : 'danger')} onClick={async () => { await api.patch(`/admin/menu-items/${i.id}`, { available: !i.available }); menu.reload(); }}>{i.available ? 'Available' : 'Sold out'}</button></td></tr>
        ))}</tbody></table></div>}
      <p className="muted small">Price edits apply to new orders only; existing orders keep their price snapshot.</p>
      <div className="row wrap"><input style={{ maxWidth: 220 }} placeholder="New category" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="New category" /><button disabled={!cat || !shopId} onClick={async () => { try { await api.post(`/admin/shops/${shopId}/categories`, { name: cat }); setCat(''); menu.reload(); } catch (e) { setMsg(errMsg(e)); } }}>Add category</button></div>
      <div className="row wrap"><input style={{ maxWidth: 220 }} placeholder="Item name" value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} aria-label="Item name" /><input style={{ maxWidth: 110 }} placeholder="₹ price" inputMode="decimal" value={item.price} onChange={(e) => setItem({ ...item, price: e.target.value })} aria-label="Item price" />
        <select style={{ maxWidth: 180 }} value={item.categoryId} onChange={(e) => setItem({ ...item, categoryId: e.target.value })} aria-label="Category"><option value="">No category</option>{menu.data?.categories?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className="primary" disabled={!item.name || !item.price || !shopId} onClick={async () => { try { await api.post(`/admin/shops/${shopId}/menu-items`, { name: item.name, basePricePaise: rupeesToPaise(item.price), categoryId: item.categoryId || null }); setItem({ name: '', price: '', categoryId: '' }); menu.reload(); } catch (e) { setMsg(errMsg(e)); } }}>Add item</button></div>
    </Section>
  );
}

// ---------- vendors ----------
function Vendors() {
  const v = useLoad<{ vendors: any[] }>('/admin/vendors');
  const shops = useLoad<{ shops: any[] }>('/admin/shops');
  const [f, setF] = useState({ name: '', email: '', password: '', shopId: '' });
  const [msg, setMsg] = useState('');
  return (
    <>
      <Section title="Vendor accounts"><Err msg={v.err} />
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Shop</th><th>Role</th></tr></thead><tbody>{v.data?.vendors.map((x) => <tr key={x.id + x.shopId}><td>{x.name}</td><td>{x.email}</td><td>{x.shopName}</td><td>{x.memberRole}</td></tr>)}</tbody></table></div></Section>
      <Section title="Create vendor login"><div className="grid2">
        <div className="field"><label htmlFor="vn">Name</label><input id="vn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="ve">Email</label><input id="ve" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="field"><label htmlFor="vp">Initial password (min 8)</label><input id="vp" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        <div className="field"><label htmlFor="vs">Shop</label><select id="vs" value={f.shopId} onChange={(e) => setF({ ...f, shopId: e.target.value })}><option value="">Choose…</option>{shops.data?.shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      </div><Err msg={msg} />
        <button className="primary" disabled={!f.name || !f.email || f.password.length < 8 || !f.shopId} onClick={async () => { setMsg(''); try { await api.post('/admin/vendors', f); setF({ name: '', email: '', password: '', shopId: '' }); v.reload(); } catch (e) { setMsg(errMsg(e)); } }}>Create vendor</button>
        <p className="muted small">The vendor can only ever see and act on the shop assigned here.</p></Section>
    </>
  );
}

// ---------- devices ----------
function Devices() {
  const d = useLoad<{ devices: any[] }>('/admin/devices');
  const shops = useLoad<{ shops: any[] }>('/admin/shops');
  const [tag, setTag] = useState('');
  const [model, setModel] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { const t = setInterval(d.reload, 15000); return () => clearInterval(t); }, [d.reload]);
  const assign = async (deviceId: string, shopId: string | null) => { setMsg(''); try { await api.post('/admin/devices/assign', { deviceId, shopId }); d.reload(); } catch (e) { setMsg(errMsg(e)); } };
  return (
    <>
      <Section title="Tablets (QuickPick property, loaned to shops)"><Err msg={msg || d.err} />
        <div className="table-wrap"><table><thead><tr><th>Asset tag</th><th>Model</th><th>Shop</th><th>Status</th><th>Last seen</th><th>Handover</th><th /></tr></thead><tbody>
          {d.data?.devices.map((x) => (
            <tr key={x.id}><td><b>{x.assetTag}</b></td><td>{x.model}</td><td><select value={x.shopId ?? ''} onChange={(e) => assign(x.id, e.target.value || null)} aria-label={`Assign ${x.assetTag}`}><option value="">Unassigned (in stock / returned)</option>{shops.data?.shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
              <td><span className="badge info">{cap(x.status)}</span></td><td>{x.lastSeenAt ? <><span className={'badge ' + (x.online ? 'ok' : 'bad')}>{x.online ? 'online' : 'offline'}</span> <span className="small muted">{dt(x.lastSeenAt)}</span></> : <span className="muted">never</span>}</td><td className="small">{x.assignedAt ? `Loaned ${dt(x.assignedAt)}` : x.returnedAt ? `Returned ${dt(x.returnedAt)}` : '—'}</td><td /></tr>
          ))}</tbody></table></div></Section>
      <Section title="Register a tablet"><div className="row wrap"><input style={{ maxWidth: 180 }} placeholder="Asset tag e.g. JQ-TAB-003" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Asset tag" /><input style={{ maxWidth: 240 }} placeholder="Model" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model" />
        <button className="primary" disabled={!tag} onClick={async () => { try { await api.post('/admin/devices', { assetTag: tag, model }); setTag(''); setModel(''); d.reload(); } catch (e) { setMsg(errMsg(e)); } }}>Register</button></div></Section>
    </>
  );
}

// ---------- pricing ----------
function Pricing({ superAdmin }: { superAdmin: boolean }) {
  const p = useLoad<{ policies: any[] }>('/admin/pricing-policies');
  const [f, setF] = useState({ feePct: '7', taxMode: 'NONE', taxPct: '0', approved: false, note: '' });
  const [msg, setMsg] = useState('');
  const save = async () => {
    setMsg('');
    try { await api.patch('/admin/pricing-policy', { feeRateBps: Math.round(parseFloat(f.feePct) * 100), taxMode: f.taxMode, taxRateBps: Math.round(parseFloat(f.taxPct) * 100), approved: f.approved, note: f.note }); p.reload(); } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <>
      <Section title="Pricing policy versions"><Err msg={p.err} />
        <p className="muted small">Each order stores a snapshot of the policy it was priced under, so changing the fee never alters past orders.</p>
        <div className="table-wrap"><table><thead><tr><th>Version</th><th>Fee</th><th>Tax on fee</th><th>Approved (CA)</th><th>Effective from</th><th>Note</th></tr></thead><tbody>
          {p.data?.policies.map((x, i) => <tr key={x.id}><td><b>v{x.version}</b>{i === 0 && <> <span className="badge ok">current</span></>}</td><td>{x.feeRateBps / 100}%</td><td>{x.taxMode === 'NONE' ? 'None' : `${x.taxMode} ${x.taxRateBps / 100}%`}</td><td>{x.approved ? <span className="badge ok">approved</span> : <span className="badge warn">NOT approved</span>}</td><td>{dt(x.effectiveFrom)}</td><td className="small">{x.note}</td></tr>)}
        </tbody></table></div></Section>
      <Section title="Create a new version">
        {!superAdmin && <div className="notice">Only the platform owner (super-admin) can change pricing.</div>}
        <div className="grid2">
          <div className="field"><label htmlFor="pf">Convenience fee (% of food subtotal)</label><input id="pf" inputMode="decimal" value={f.feePct} onChange={(e) => setF({ ...f, feePct: e.target.value })} /></div>
          <div className="field"><label htmlFor="pm">Tax treatment of the fee</label><select id="pm" value={f.taxMode} onChange={(e) => setF({ ...f, taxMode: e.target.value })}><option value="NONE">None</option><option value="EXCLUSIVE">Added on top</option><option value="INCLUSIVE">Included in fee</option></select></div>
          <div className="field"><label htmlFor="pt">Tax rate (%)</label><input id="pt" inputMode="decimal" value={f.taxPct} onChange={(e) => setF({ ...f, taxPct: e.target.value })} disabled={f.taxMode === 'NONE'} /></div>
          <div className="field"><label htmlFor="pn">Note</label><input id="pn" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        </div>
        <label className="row"><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={f.approved} onChange={(e) => setF({ ...f, approved: e.target.checked })} /> Tick only after the CA’s written opinion approves this treatment</label>
        <Err msg={msg} /><button className="primary" disabled={!superAdmin} onClick={save}>Publish new version</button>
      </Section>
    </>
  );
}

// ---------- payments / reconciliation ----------
function Payments() {
  const pay = useLoad<{ payments: any[] }>('/admin/payments');
  const rec = useLoad<{ rows: any[] }>('/admin/reconciliation');
  return (
    <>
      <Section title="Payments (sandbox provider)"><Err msg={pay.err} />
        <div className="table-wrap"><table><thead><tr><th>Order</th><th>Provider ref</th><th>Amount</th><th>Refunded</th><th>Status</th><th>When</th></tr></thead><tbody>
          {pay.data?.payments.map((p) => <tr key={p.id}><td><b>{p.orderNumber}</b></td><td className="mono">{p.providerRef}</td><td className="price">{formatPaise(p.amountPaise)}</td><td className="price">{formatPaise(p.refundedPaise)}</td><td><span className={'badge ' + tone(p.status)}>{pstatus(p.status)}</span></td><td>{dt(p.createdAt)}</td></tr>)}
        </tbody></table></div></Section>
      <Section title="Reconciliation (paid vs planned split)"><Err msg={rec.err} />
        <div className="table-wrap"><table><thead><tr><th>Order</th><th>Paid</th><th>Planned split</th><th>Refunded</th><th>Status</th><th>Check</th></tr></thead><tbody>
          {rec.data?.rows.map((r) => <tr key={r.orderNumber}><td>{r.orderNumber}</td><td className="price">{formatPaise(r.paidPaise)}</td><td className="price">{formatPaise(r.plannedSplitPaise)}</td><td className="price">{formatPaise(r.refundedPaise)}</td><td>{pstatus(r.paymentStatus)}</td><td>{r.matches ? <span className="badge ok">matches</span> : <span className="badge bad">diff {formatPaise(r.differencePaise)}</span>}</td></tr>)}
        </tbody></table></div><p className="muted small">Real settlement reports from a provider are not connected yet; settlement stays separate from payment success.</p></Section>
    </>
  );
}

// ---------- support + audit ----------
function Support() {
  const c = useLoad<{ complaints: any[] }>('/admin/complaints');
  const [msg, setMsg] = useState('');
  const set = async (id: string, status: string) => { const resolution = status === 'RESOLVED' ? window.prompt('Resolution note') ?? undefined : undefined; try { await api.patch(`/admin/complaints/${id}`, { status, resolution }); c.reload(); } catch (e) { setMsg(errMsg(e)); } };
  return (
    <Section title="Support requests"><Err msg={c.err || msg} />
      <div className="table-wrap"><table><thead><tr><th>Order</th><th>Category</th><th>Description</th><th>Status</th><th>Resolution</th><th /></tr></thead><tbody>
        {c.data?.complaints.map((x) => <tr key={x.id}><td>{x.orderNumber}</td><td>{x.category}</td><td>{x.description}</td><td><span className={'badge ' + tone(x.status)}>{cap(x.status)}</span></td><td>{x.resolution}</td><td><div className="row wrap">{x.status !== 'IN_PROGRESS' && x.status !== 'RESOLVED' && <button className="small" onClick={() => set(x.id, 'IN_PROGRESS')}>Start</button>}{x.status !== 'RESOLVED' && <button className="small ok" onClick={() => set(x.id, 'RESOLVED')}>Resolve</button>}</div></td></tr>)}
        {c.data?.complaints.length === 0 && <tr><td colSpan={6} className="muted">No support requests.</td></tr>}
      </tbody></table></div></Section>
  );
}

function Audit() {
  const a = useLoad<{ logs: any[] }>('/admin/audit-logs');
  return (
    <Section title="Audit log (sensitive and financial actions)"><Err msg={a.err} />
      <div className="table-wrap"><table><thead><tr><th>When</th><th>Role</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>
        {a.data?.logs.map((l) => <tr key={l.id}><td>{dt(l.created_at)}</td><td>{l.actor_role}</td><td><b>{l.action}</b></td><td>{l.entity_type} <span className="mono">{l.entity_id?.slice(0, 8)}</span></td><td className="mono">{JSON.stringify(l.metadata)}</td></tr>)}
      </tbody></table></div></Section>
  );
}

export type { OrderStatus };
