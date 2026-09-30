import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { io as ioClient } from 'socket.io-client';
import { config } from '../src/config.js';
import { createSocketServer } from '../src/envia-websocket/socket.js';
import { redis } from '../src/redis.js';

let server;
let url;
let io;
let duplicata;

before(async () => {
  // createSocketServer duplica a conexão Redis (pro adapter do Socket.IO);
  // capturamos essa duplicata aqui só pra poder fechá-la depois do teste.
  const duplicateOriginal = redis.duplicate.bind(redis);
  redis.duplicate = (...args) => {
    duplicata = duplicateOriginal(...args);
    return duplicata;
  };

  server = http.createServer();
  io = createSocketServer(server);
  redis.duplicate = duplicateOriginal;

  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;
});

after(async () => {
  io.close();
  duplicata?.disconnect();
  redis.disconnect();
});

function conectar(token) {
  return ioClient(url, { auth: { token }, reconnection: false, forceNew: true });
}

describe('servidor Socket.IO (createSocketServer)', () => {
  test('conexão com JWT válido é aceita e entra na sala do usuário', async () => {
    const token = jwt.sign({ role: 'cliente', sub: 99 }, config.jwtSecret);
    const client = conectar(token);
    try {
      await new Promise((resolve, reject) => {
        client.on('connect', resolve);
        client.on('connect_error', reject);
      });
      assert.ok(client.connected);
    } finally {
      client.close();
    }
  });

  test('conexão sem token é recusada', async () => {
    const client = conectar(undefined);
    try {
      const erro = await new Promise((resolve) => {
        client.on('connect', () => resolve(null));
        client.on('connect_error', resolve);
      });
      assert.ok(erro, 'esperava connect_error');
      assert.match(erro.message, /não autorizado/);
    } finally {
      client.close();
    }
  });

  test('conexão com token de papel inválido é recusada', async () => {
    const token = jwt.sign({ role: 'admin', sub: 1 }, config.jwtSecret);
    const client = conectar(token);
    try {
      const erro = await new Promise((resolve) => {
        client.on('connect', () => resolve(null));
        client.on('connect_error', resolve);
      });
      assert.ok(erro, 'esperava connect_error');
    } finally {
      client.close();
    }
  });
});
