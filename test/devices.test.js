import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { redis } from '../src/redis.js';
import { devices } from '../src/envia-push/devices.js';

const USER_ID = 'cliente:teste-devices';

after(async () => {
  await redis.del(`devices:${USER_ID}`);
  redis.disconnect();
});

describe('devices (Redis real)', () => {
  test('list começa vazia para um usuário sem devices', async () => {
    assert.deepEqual(await devices.list(USER_ID), []);
  });

  test('add registra um device_token e list devolve ele', async () => {
    await devices.add(USER_ID, 'token-1');
    assert.deepEqual(await devices.list(USER_ID), ['token-1']);
  });

  test('add é idempotente (SET, sem duplicar)', async () => {
    await devices.add(USER_ID, 'token-1');
    assert.deepEqual(await devices.list(USER_ID), ['token-1']);
  });

  test('remove tira o token da lista', async () => {
    await devices.add(USER_ID, 'token-2');
    await devices.remove(USER_ID, 'token-1');
    assert.deepEqual(await devices.list(USER_ID), ['token-2']);
  });
});
