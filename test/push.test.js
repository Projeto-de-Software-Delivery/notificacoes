import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { redis } from '../src/redis.js';
import { devices } from '../src/envia-push/devices.js';
import { sendPush } from '../src/envia-push/push.js';

const USER_ID = 'cliente:teste-push';

before(async () => {
  await redis.del(`devices:${USER_ID}`);
});

after(async () => {
  await redis.del(`devices:${USER_ID}`);
  redis.disconnect();
});

describe('sendPush (modo log, sem credencial do Firebase)', () => {
  test('sem device registrado não envia nada', async () => {
    const resultado = await sendPush(USER_ID, { title: 'Oi', body: 'Teste' });
    assert.deepEqual(resultado, { sent: 0 });
  });

  test('com device registrado, roda em modo log (dryRun)', async () => {
    await devices.add(USER_ID, 'token-push-1');

    const resultado = await sendPush(USER_ID, { title: 'Oi', body: 'Teste' });

    assert.equal(resultado.sent, 1);
    assert.equal(resultado.dryRun, true);
  });
});
