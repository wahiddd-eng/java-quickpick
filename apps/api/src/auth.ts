import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { HttpError, type AppContext } from './context.js';

export type Role = 'STUDENT' | 'VENDOR' | 'ADMIN' | 'SUPER_ADMIN';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  shopIds: string[];
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthUser;
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function signToken(ctx: AppContext, user: { id: string; role: Role }) {
  const expiresIn = user.role === 'STUDENT' ? '7d' : '12h';
  return jwt.sign({ sub: user.id, role: user.role }, ctx.config.jwtSecret, { expiresIn });
}

export async function authenticateToken(ctx: AppContext, token: string): Promise<AuthUser> {
  let payload: any;
  try {
    payload = jwt.verify(token, ctx.config.jwtSecret);
  } catch {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid or expired session');
  }
  const users = await ctx.db.query(`SELECT id, name, email, role, status FROM users WHERE id=$1`, [payload.sub]);
  const u = users[0];
  if (!u || u.status !== 'ACTIVE') throw new HttpError(401, 'UNAUTHENTICATED', 'Account is not active');
  let shopIds: string[] = [];
  if (u.role === 'VENDOR') {
    shopIds = (
      await ctx.db.query(
        `SELECT sm.shop_id FROM shop_members sm JOIN shops s ON s.id = sm.shop_id WHERE sm.user_id=$1 AND sm.status='ACTIVE'`,
        [u.id],
      )
    ).map((r: any) => r.shop_id);
  }
  return { id: u.id, name: u.name, email: u.email, role: u.role, shopIds };
}

/** Server-side RBAC. SUPER_ADMIN is a superset of ADMIN. Frontend hiding is never relied upon. */
export function requireRole(ctx: AppContext, ...roles: Role[]): RequestHandler {
  const allowed = new Set<Role>(roles);
  if (allowed.has('ADMIN')) allowed.add('SUPER_ADMIN');
  return asyncHandler(async (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required');
    req.auth = await authenticateToken(ctx, header.slice(7));
    if (!allowed.has(req.auth.role)) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource');
    next();
  });
}

/** Resolve which shop a vendor request acts on — only ever one of the vendor's own memberships. */
export function vendorShopId(req: Request): string {
  const auth = req.auth!;
  const requested = (req.headers['x-shop-id'] as string | undefined) ?? (req.query.shopId as string | undefined);
  if (requested) {
    if (!auth.shopIds.includes(requested)) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to that shop');
    return requested;
  }
  if (auth.shopIds.length === 1) return auth.shopIds[0];
  if (auth.shopIds.length === 0) throw new HttpError(403, 'NO_SHOP', 'This account is not assigned to a shop');
  throw new HttpError(400, 'SHOP_REQUIRED', 'Specify a shop with the x-shop-id header');
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string | null) => (hash ? bcrypt.compare(pw, hash) : Promise.resolve(false));
export const hashOtp = (email: string, code: string) => crypto.createHash('sha256').update(`${email}:${code}`).digest('hex');
