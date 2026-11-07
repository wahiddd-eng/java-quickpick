# Operational runbook — vendor tablets and lunch rush

## Tablet setup (each loaned tablet)

1. Register it in **Admin → Tablets** with its asset tag (e.g. `JQ-TAB-003`) and model, then assign it to the shop. The handover date is recorded; tablets remain QuickPick property.
2. On the tablet: open the vendor app URL in Chrome → menu → **Add to Home screen**. Launch from the icon (full screen).
3. Sign in with the shop's vendor login. Tap **Enable sound** once per session (browsers block sound until a tap) and test the volume at counter noise level.
4. Android settings: screen timeout → never/30 min while plugged in; battery optimisation **off** for Chrome; notifications/sound on; Do Not Disturb off; keep it on the charger.
5. Optional kiosk: Android *App pinning* (Settings → Security → App pinning) to keep staff in the app.
6. Admin → Tablets should show it **online** within 30 s (heartbeat).

## Daily opening checklist (before lunch)

- Tablet charged, on Wi-Fi, app open, header shows **Online** and **Taking orders**.
- Menu availability updated (sold-out items switched off).
- Capacity per slot matches today's staff (Admin → Shops). Start low; raise only from measured throughput.

## During service

- New orders pulse red with a countdown. Accept (choose prep time) or reject with a reason before it runs out — unanswered orders auto-cancel with a full refund.
- Too busy? **Pause new orders** — existing orders are unaffected.
- Handover: ask for the student's 4-digit code, type it, tap **Handed over**. Wrong code is refused. No-show → **No-show**.
- Can't fulfil an accepted order → **Can't make it — cancel & refund**.

## When things go wrong

| Symptom | What to do |
|---|---|
| Header says **Reconnecting / Offline** | Check Wi-Fi. The board keeps refreshing every 8 s and reloads fully on reconnect; no order is lost because orders live in the database. |
| Wi-Fi down for minutes | Switch the tablet to a phone hotspot. If none, pause orders from the admin console (Admin → Shops) so students stop ordering. |
| No sound | Tap **Enable sound** again; check volume / DND; reload the app. |
| Tablet dead or lost | Sign in on any phone/laptop with the vendor login — same board. Mark the tablet returned/reassigned in Admin → Tablets. |
| Student says they paid, order missing | Admin → Payments: find the order. Only webhook-confirmed payments count; if a payment exists without a live order, it was auto-refunded (see order timeline). |
| Wrong item / complaint | Admin → Support, then Orders → Details → partial or full refund with a reason (audited). |

## End of day

Admin → Overview → **Export today's orders (CSV)**. Check Payments & refunds → Reconciliation shows "matches" for every paid order.

## Hard rule

This build is sandbox only. Do not connect a real payment provider until FSSAI, CA (GST), provider marketplace agreement and SRM/Java permissions are all in writing.
