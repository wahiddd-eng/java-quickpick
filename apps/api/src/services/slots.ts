import { HttpError, IST_OFFSET_MS, istDate, type AppContext } from '../context.js';
import type { Queryable } from '../db.js';

export interface SlotRow {
  id: string;
  shop_id: string;
  starts_at: Date;
  ends_at: Date;
  capacity: number;
  reserved_count: number;
}

/** Slot windows for a given IST calendar date from a shop's HH:MM hours and slot length. */
export function slotWindows(date: string, open: string, close: string, minutes: number): Array<{ start: Date; end: Date }> {
  const start0 = new Date(`${date}T${open}:00+05:30`).getTime();
  const end0 = new Date(`${date}T${close}:00+05:30`).getTime();
  const step = minutes * 60_000;
  const out: Array<{ start: Date; end: Date }> = [];
  for (let t = start0; t + step <= end0; t += step) out.push({ start: new Date(t), end: new Date(t + step) });
  return out;
}

/** True when a stored slot still matches the shop's current hours and slot length (hours can be edited mid-day). */
export function slotMatchesShop(shop: any, slot: { starts_at: Date | string; ends_at: Date | string }): boolean {
  const start = new Date(slot.starts_at).getTime();
  const end = new Date(slot.ends_at).getTime();
  const day = istDate(new Date(start));
  return slotWindows(day, shop.open_time, shop.close_time, shop.slot_minutes).some((w) => w.start.getTime() === start && w.end.getTime() === end);
}

/** Drop future slots nobody has booked so they are rebuilt from new hours. Booked slots stay for their orders. */
export async function resetUnbookedSlots(ctx: AppContext, q: Queryable, shopId: string): Promise<void> {
  await q.query(`DELETE FROM pickup_slots WHERE shop_id=$1 AND starts_at > $2 AND reserved_count = 0`, [shopId, ctx.now()]);
}

/** Lazily materialise the day's slots from the shop's configuration. Existing slots are never touched. */
export async function ensureSlots(q: Queryable, shop: any, date: string): Promise<void> {
  const windows = slotWindows(date, shop.open_time, shop.close_time, shop.slot_minutes);
  if (windows.length === 0) return;
  const values: string[] = [];
  const params: unknown[] = [shop.id, shop.slot_capacity];
  windows.forEach((w, i) => {
    params.push(w.start, w.end);
    values.push(`($1, $${3 + i * 2}, $${4 + i * 2}, $2)`);
  });
  await q.query(
    `INSERT INTO pickup_slots (shop_id, starts_at, ends_at, capacity) VALUES ${values.join(',')} ON CONFLICT (shop_id, starts_at) DO NOTHING`,
    params,
  );
}

export async function listAvailableSlots(ctx: AppContext, q: Queryable, shop: any, date?: string) {
  const now = ctx.now();
  const day = date ?? istDate(now);
  await ensureSlots(q, shop, day);
  const earliest = new Date(now.getTime() + ctx.config.minLeadMinutes * 60_000);
  const dayStart = new Date(`${day}T00:00:00+05:30`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
  const rows = await q.query<SlotRow>(
    `SELECT * FROM pickup_slots WHERE shop_id=$1 AND starts_at >= $2 AND starts_at >= $3 AND starts_at < $4 ORDER BY starts_at`,
    [shop.id, earliest, dayStart, dayEnd],
  );
  return rows.filter((s) => slotMatchesShop(shop, s)).map((s) => ({
    id: s.id,
    startsAt: s.starts_at,
    endsAt: s.ends_at,
    capacity: s.capacity,
    remaining: Math.max(0, s.capacity - s.reserved_count),
    full: s.reserved_count >= s.capacity,
  }));
}

/**
 * Atomic reservation: a single conditional UPDATE. Under PostgreSQL row locking, two concurrent requests for the last
 * place serialise on the row, so only one can satisfy `reserved_count < capacity`.
 */
export async function reserveSlot(ctx: AppContext, q: Queryable, slotId: string, shopId: string): Promise<SlotRow> {
  const slots = await q.query<SlotRow>(`SELECT * FROM pickup_slots WHERE id=$1 AND shop_id=$2`, [slotId, shopId]);
  const slot = slots[0];
  if (!slot) throw new HttpError(404, 'SLOT_NOT_FOUND', 'Pickup slot not found for this shop');
  const earliest = ctx.now().getTime() + ctx.config.minLeadMinutes * 60_000;
  if (new Date(slot.starts_at).getTime() < earliest) throw new HttpError(409, 'SLOT_UNAVAILABLE', 'That pickup time has passed or is too soon');
  const updated = await q.query<SlotRow>(
    `UPDATE pickup_slots SET reserved_count = reserved_count + 1 WHERE id=$1 AND reserved_count < capacity RETURNING *`,
    [slotId],
  );
  if (!updated[0]) throw new HttpError(409, 'SLOT_FULL', 'That pickup slot is full. Please choose another time.');
  return updated[0];
}

/** Exactly-once release, guarded by orders.slot_released so duplicate events/expiry jobs never double-decrement. */
export async function releaseSlot(q: Queryable, orderId: string): Promise<boolean> {
  const flagged = await q.query<{ slot_id: string }>(
    `UPDATE orders SET slot_released = true WHERE id=$1 AND slot_released = false RETURNING slot_id`,
    [orderId],
  );
  if (!flagged[0]) return false;
  await q.query(`UPDATE pickup_slots SET reserved_count = GREATEST(reserved_count - 1, 0) WHERE id=$1`, [flagged[0].slot_id]);
  return true;
}

export function isOpenNow(shop: { open_time: string; close_time: string }, now: Date): boolean {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const hhmm = ist.toISOString().slice(11, 16);
  return hhmm >= shop.open_time && hhmm < shop.close_time;
}
