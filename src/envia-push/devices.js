import { redis } from '../redis.js';

/**
 * Aparelhos registrados de cada usuário (os device_tokens do FCM/APNs).
 * O app registra no login e remove no logout.
 *
 * Chave no Redis: devices:{user_id}  (SET de device_token)
 *   user_id leva o papel na frente: cliente:42, loja:7, entregador:13
 */
const chave = (userId) => `devices:${userId}`;

export const devices = {
  add: (userId, token) => redis.sadd(chave(userId), token),
  remove: (userId, token) => redis.srem(chave(userId), token),
  list: (userId) => redis.smembers(chave(userId)),
};
