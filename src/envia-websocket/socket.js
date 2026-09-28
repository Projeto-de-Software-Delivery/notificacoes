import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { redis } from '../redis.js';

const ROLES = new Set(['cliente', 'loja', 'entregador']);

/** Lê o JWT (emitido pelo API Gateway / auth) e devolve o user_id "papel:id". */
export function userIdFromToken(token) {
  const claims = jwt.verify(token, config.jwtSecret);
  if (!ROLES.has(claims.role) || claims.sub == null) {
    throw new Error('token sem role/sub válidos');
  }
  return `${claims.role}:${claims.sub}`;
}

/** Cada usuário tem a sua sala; é para ela que o dispatcher emite. */
export const room = (userId) => `user:${userId}`;

/** Tem algum app aberto? Vale entre réplicas, graças ao adapter Redis. */
export async function estaOnline(io, userId) {
  const sockets = await io.in(room(userId)).fetchSockets();
  return sockets.length > 0;
}

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, { cors: { origin: '*' } });

  // Adapter Redis: permite rodar várias réplicas do serviço e ainda assim
  // entregar para um socket conectado em outra instância.
  io.adapter(createAdapter(redis, redis.duplicate()));

  // Só entra quem tem um JWT válido.
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token
        ?? socket.handshake.headers.authorization?.replace(/^Bearer /, '');
      socket.data.userId = userIdFromToken(token);
      next();
    } catch {
      next(new Error('não autorizado'));
    }
  });

  io.on('connection', (socket) => {
    const { userId } = socket.data;
    socket.join(room(userId));
    console.log(`[ws] conectado ${userId} (${socket.id})`);
    socket.on('disconnect', () => console.log(`[ws] desconectado ${userId} (${socket.id})`));
  });

  return io;
}
