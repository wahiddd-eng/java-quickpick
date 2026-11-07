import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler, hashOtp, requireRole, signToken, verifyPassword } from '../auth.js';
import { HttpError, type AppContext } from '../context.js';

const limiter = (max: number) =>
  rateLimit({ windowMs: 15 * 60_000, max, standardHeaders: true, legacyHeaders: false, skip: () => process.env.VITEST === 'true' });

const OTP_TTL_MS = 5 * 60_000;
const MAX_OTP_ATTEMPTS = 5;

export function authRoutes(ctx: AppContext): Router {
  const r = Router();

  // Student sign-in by one-time code. The OTP delivery provider is abstracted: in development the code is echoed in the
  // response (OTP_DEV_ECHO); no real SMS/email provider is wired yet and the SRM verification approach is still open.
  r.post(
    '/auth/otp/request',
    limiter(10),
    asyncHandler(async (req, res) => {
      const { email } = z.object({ email: z.string().email().max(200) }).parse(req.body);
      const e = email.toLowerCase();
      const code = String(crypto.randomInt(100000, 1000000));
      await ctx.db.query(`INSERT INTO otp_codes (email, code_hash, expires_at) VALUES ($1,$2,$3)`, [
        e,
        hashOtp(e, code),
        new Date(ctx.now().getTime() + OTP_TTL_MS),
      ]);
      res.json({ ok: true, ...(ctx.config.otpDevEcho ? { devCode: code } : {}) });
    }),
  );

  r.post(
    '/auth/otp/verify',
    limiter(20),
    asyncHandler(async (req, res) => {
      const body = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/), name: z.string().min(1).max(80).optional() }).parse(req.body);
      const e = body.email.toLowerCase();
      const rows = await ctx.db.query(
        `SELECT * FROM otp_codes WHERE email=$1 AND consumed=false AND expires_at > $2 ORDER BY id DESC LIMIT 1`,
        [e, ctx.now()],
      );
      const otp = rows[0];
      if (!otp || otp.attempts >= MAX_OTP_ATTEMPTS) throw new HttpError(401, 'INVALID_OTP', 'Invalid or expired code');
      if (otp.code_hash !== hashOtp(e, body.code)) {
        await ctx.db.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id=$1`, [otp.id]);
        throw new HttpError(401, 'INVALID_OTP', 'Invalid or expired code');
      }
      await ctx.db.query(`UPDATE otp_codes SET consumed=true WHERE id=$1`, [otp.id]);
      let users = await ctx.db.query(`SELECT * FROM users WHERE email=$1`, [e]);
      if (!users[0]) {
        users = await ctx.db.query(`INSERT INTO users (name, email, role) VALUES ($1,$2,'STUDENT') RETURNING *`, [
          body.name?.trim() || e.split('@')[0],
          e,
        ]);
      }
      const u = users[0];
      if (u.role !== 'STUDENT') throw new HttpError(403, 'WRONG_LOGIN', 'Use the staff sign-in for this account');
      if (u.status !== 'ACTIVE') throw new HttpError(403, 'ACCOUNT_DISABLED', 'Account disabled');
      res.json({ token: signToken(ctx, u), user: { id: u.id, name: u.name, email: u.email, role: u.role } });
    }),
  );

  // Vendor + admin sign-in by password.
  r.post(
    '/auth/login',
    limiter(20),
    asyncHandler(async (req, res) => {
      const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).parse(req.body);
      const users = await ctx.db.query(`SELECT * FROM users WHERE email=$1`, [email.toLowerCase()]);
      const u = users[0];
      const ok = u && u.role !== 'STUDENT' && u.status === 'ACTIVE' && (await verifyPassword(password, u.password_hash));
      if (!ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
      res.json({ token: signToken(ctx, u), user: { id: u.id, name: u.name, email: u.email, role: u.role } });
    }),
  );

  r.get(
    '/me',
    requireRole(ctx, 'STUDENT', 'VENDOR', 'ADMIN'),
    asyncHandler(async (req, res) => {
      res.json({ user: req.auth });
    }),
  );

  return r;
}
