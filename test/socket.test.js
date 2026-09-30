import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import { userIdFromToken, room, estaOnline } from '../src/envia-websocket/socket.js';
import { redis } from '../src/redis.js';

// socket.js importa o cliente Redis (pro adapter do Socket.IO) mesmo sem usá-lo
// nos testes abaixo; sem isso o processo do test runner não termina sozinho.
after(() => redis.disconnect());

const assinar = (claims) => jwt.sign(claims, config.jwtSecret);

describe('userIdFromToken', () => {
  test('monta "papel:id" a partir de um token válido', () => {
    const token = assinar({ role: 'cliente', sub: 42 });
    assert.equal(userIdFromToken(token), 'cliente:42');
  });

  test('aceita os três papéis do domínio', () => {
    assert.equal(userIdFromToken(assinar({ role: 'loja', sub: 7 })), 'loja:7');
    assert.equal(userIdFromToken(assinar({ role: 'entregador', sub: 13 })), 'entregador:13');
  });

  test('rejeita papel fora do domínio', () => {
    const token = assinar({ role: 'admin', sub: 1 });
    assert.throws(() => userIdFromToken(token), /role\/sub/);
  });

  test('rejeita token sem sub', () => {
    const token = assinar({ role: 'cliente' });
    assert.throws(() => userIdFromToken(token), /role\/sub/);
  });

  test('rejeita token com assinatura inválida', () => {
    const token = jwt.sign({ role: 'cliente', sub: 1 }, 'chave-errada');
    assert.throws(() => userIdFromToken(token));
  });
});

test('room prefixa o userId com "user:"', () => {
  assert.equal(room('cliente:42'), 'user:cliente:42');
});

describe('estaOnline', () => {
  test('true quando há sockets na sala do usuário', async () => {
    const io = { in: () => ({ fetchSockets: async () => [{ id: 's1' }] }) };
    assert.equal(await estaOnline(io, 'cliente:42'), true);
  });

  test('false quando a sala está vazia', async () => {
    const io = { in: () => ({ fetchSockets: async () => [] }) };
    assert.equal(await estaOnline(io, 'cliente:42'), false);
  });
});
