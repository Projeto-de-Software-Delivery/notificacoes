import { test, describe, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from '../src/dispatcher.js';
import { devices } from '../src/envia-push/devices.js';
import { redis } from '../src/redis.js';

// dispatcher.js importa push.js -> devices.js -> redis.js; nada aqui chama
// o Redis de verdade (devices.list é substituído em cada teste), mas a
// conexão aberta pelo import sozinha já impede o processo de terminar.
after(() => redis.disconnect());

function fakeIo(onlineRooms = new Set()) {
  const emitidos = [];
  const io = {
    emitidos,
    to: (room) => ({
      emit: (evento, payload) => emitidos.push({ room, evento, payload }),
    }),
    in: (room) => ({
      fetchSockets: async () => (onlineRooms.has(room) ? [{ id: 'socket-fake' }] : []),
    }),
  };
  return io;
}

describe('dispatch', () => {
  let chamadasDevicesList;
  let listOriginal;

  beforeEach(() => {
    chamadasDevicesList = [];
    listOriginal = devices.list;
    devices.list = async (userId) => {
      chamadasDevicesList.push(userId);
      return [];
    };
  });

  afterEach(() => {
    devices.list = listOriginal;
  });

  test('evento desconhecido não emite nada e não olha devices', async () => {
    const io = fakeIo();

    await dispatch(io, 'topico.que.nao.existe', { pedidoId: 1 });

    assert.deepEqual(io.emitidos, []);
    assert.deepEqual(chamadasDevicesList, []);
  });

  test('pedido.criado emite pedido:status pra loja e cliente com o status certo', async () => {
    const io = fakeIo(new Set(['user:loja:7', 'user:cliente:42']));

    await dispatch(io, 'pedido.criado', { pedidoId: 10, clienteId: 42, lojaId: 7 });

    assert.equal(io.emitidos.length, 2);
    const paraLoja = io.emitidos.find((e) => e.room === 'user:loja:7');
    assert.equal(paraLoja.evento, 'pedido:status');
    assert.equal(paraLoja.payload.status, 'AGUARDANDO_VALIDACAO');
    assert.equal(paraLoja.payload.pedido_id, 10);
    const paraCliente = io.emitidos.find((e) => e.room === 'user:cliente:42');
    assert.equal(paraCliente.payload.title, 'Pedido enviado');
  });

  test('destino online nunca aciona push, mesmo com push:true (default)', async () => {
    const io = fakeIo(new Set(['user:loja:7']));

    await dispatch(io, 'pedido.criado', { pedidoId: 10, clienteId: 42, lojaId: 7 });

    assert.deepEqual(chamadasDevicesList, []);
  });

  test('destino offline com push:true (default) consulta os devices dele', async () => {
    const io = fakeIo(); // ninguém online

    await dispatch(io, 'pedido.criado', { pedidoId: 10, clienteId: 42, lojaId: 7 });

    assert.ok(chamadasDevicesList.includes('loja:7'));
  });

  test('destino com push:false nunca consulta devices, mesmo offline', async () => {
    const io = fakeIo(); // ninguém online

    await dispatch(io, 'pedido.criado', { pedidoId: 10, clienteId: 42, lojaId: 7 });

    // pedido.criado marca o destino do cliente como push:false
    assert.ok(!chamadasDevicesList.includes('cliente:42'));
  });
});
