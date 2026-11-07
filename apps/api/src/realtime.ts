import type http from 'node:http';
import { Server } from 'socket.io';
import { authenticateToken } from './auth.js';
import type { AppContext } from './context.js';

/**
 * Socket.IO only *signals* that something changed. PostgreSQL stays the source of truth: clients refetch over REST on
 * every signal, on reconnect, and on a polling fallback, so a dropped socket can never lose an order.
 */
export function attachRealtime(ctx: AppContext, server: http.Server) {
  const io = new Server(server, { cors: { origin: ctx.config.corsOrigins } });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') throw new Error('no token');
      socket.data.user = await authenticateToken(ctx, token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const u = socket.data.user;
    if (u.role === 'VENDOR') for (const id of u.shopIds) socket.join(`shop:${id}`);
    else if (u.role === 'STUDENT') socket.join(`user:${u.id}`);
    else socket.join('admin');
  });

  ctx.bus.onOrder((n) => {
    // Vendors are told only about paid orders — never about unpaid or failed checkouts.
    if (n.notifyVendor) io.to(`shop:${n.shopId}`).emit('order', { orderId: n.orderId, status: n.status, kind: n.kind });
    io.to(`user:${n.userId}`).emit('order', { orderId: n.orderId, status: n.status, kind: 'UPDATE' });
    io.to('admin').emit('order', { orderId: n.orderId, status: n.status, kind: 'UPDATE' });
  });

  return io;
}
