import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTOS, TOPICOS, STATUS_POR_EVENTO } from '../src/recebe-rabbitmq/eventos.js';

const DADOS = { pedidoId: 10, clienteId: 42, lojaId: 7, entregadorId: 13 };

describe('eventos', () => {
  test('TOPICOS lista os 5 eventos do payloads.md', () => {
    assert.deepEqual(TOPICOS, [
      'pedido.criado',
      'pedido.validado',
      'entrega.aceita',
      'pedido.retirado',
      'pedido.entregue',
    ]);
  });

  test('cada evento em TOPICOS tem um status correspondente', () => {
    for (const evento of TOPICOS) {
      assert.ok(STATUS_POR_EVENTO[evento], `sem status para ${evento}`);
    }
  });

  test('pedido.criado avisa loja (push) e cliente (só socket)', () => {
    const destinos = EVENTOS['pedido.criado'](DADOS);
    assert.equal(destinos.length, 2);
    assert.equal(destinos[0].to, 'loja:7');
    assert.equal(destinos[0].push, undefined);
    assert.equal(destinos[1].to, 'cliente:42');
    assert.equal(destinos[1].push, false);
  });

  test('pedido.validado avisa só o cliente', () => {
    const destinos = EVENTOS['pedido.validado'](DADOS);
    assert.deepEqual(destinos.map((d) => d.to), ['cliente:42']);
  });

  test('entrega.aceita avisa cliente e loja', () => {
    const destinos = EVENTOS['entrega.aceita'](DADOS);
    assert.deepEqual(destinos.map((d) => d.to), ['cliente:42', 'loja:7']);
  });

  test('pedido.retirado avisa só o cliente', () => {
    const destinos = EVENTOS['pedido.retirado'](DADOS);
    assert.deepEqual(destinos.map((d) => d.to), ['cliente:42']);
  });

  test('pedido.entregue avisa cliente, loja e entregador quando presente', () => {
    const destinos = EVENTOS['pedido.entregue'](DADOS).filter(Boolean);
    assert.deepEqual(destinos.map((d) => d.to), ['cliente:42', 'loja:7', 'entregador:13']);
  });

  test('pedido.entregue não quebra quando entregadorId está ausente', () => {
    const { entregadorId, ...semEntregador } = DADOS;
    const destinos = EVENTOS['pedido.entregue'](semEntregador).filter(Boolean);
    assert.deepEqual(destinos.map((d) => d.to), ['cliente:42', 'loja:7']);
  });
});
