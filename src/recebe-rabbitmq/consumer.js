import amqp from 'amqplib';
import { config } from '../config.js';
import { TOPICOS } from './eventos.js';

// Exchange e fila para onde vão as mensagens que deram erro.
const DLX = `${config.exchange}.dlx`;
const DLQ = `${config.queue}.dlq`;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Escuta os eventos do pedido no RabbitMQ e chama
 * onMessage(routingKey, payload) para cada um.
 * Se o broker cair, reconecta sozinho.
 */
export async function startConsumer(onMessage) {
  let espera = 1000;

  while (true) {
    try {
      await consumir(onMessage); // só retorna quando a conexão cai
      console.error('[amqp] conexão fechada');
      espera = 1000;
    } catch (err) {
      console.error(`[amqp] sem conexão: ${err.message}`);
      espera = Math.min(espera * 2, 30000);
    }
    console.error(`[amqp] tentando de novo em ${espera / 1000}s`);
    await esperar(espera);
  }
}

/** Abre a conexão, consome a fila e só termina quando a conexão fecha. */
async function consumir(onMessage) {
  const conn = await amqp.connect(config.rabbitUrl);
  const ch = await conn.createChannel();

  // fila de erro: o que falhar aqui cai na DLQ e não se perde
  await ch.assertExchange(DLX, 'fanout', { durable: true });
  await ch.assertQueue(DLQ, { durable: true });
  await ch.bindQueue(DLQ, DLX, '');

  // fila deste serviço, ligada a cada tópico que sabemos tratar
  await ch.assertExchange(config.exchange, 'topic', { durable: true });
  await ch.assertQueue(config.queue, { durable: true, deadLetterExchange: DLX });
  for (const topico of TOPICOS) {
    await ch.bindQueue(config.queue, config.exchange, topico);
  }

  await ch.prefetch(20);
  await ch.consume(config.queue, async (msg) => {
    if (!msg) return;
    try {
      await onMessage(msg.fields.routingKey, JSON.parse(msg.content.toString()));
      ch.ack(msg);
    } catch (err) {
      console.error(`[amqp] falha em ${msg.fields.routingKey}: ${err.message}`);
      ch.nack(msg, false, false); // não requeue: vai para a DLQ
    }
  });

  console.log(`[amqp] consumindo ${config.queue} <- ${config.exchange} [${TOPICOS.join(', ')}]`);

  conn.on('error', (err) => console.error(`[amqp] erro: ${err.message}`));
  await new Promise((fechou) => conn.on('close', fechou));
}
