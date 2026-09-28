import { EVENTOS, STATUS_POR_EVENTO } from './recebe-rabbitmq/eventos.js';
import { room, estaOnline } from './envia-websocket/socket.js';
import { sendPush } from './envia-push/push.js';

/**
 * A ponte entre os dois lados: pega o evento que veio do RabbitMQ e entrega
 * para cada destinatário.
 *  - WebSocket: sempre (evento "pedido:status"), alcança quem está com o app aberto;
 *  - Push: só para quem não tem nenhum app aberto, para não avisar duas vezes.
 */
export async function dispatch(io, routingKey, evento) {
  const montarDestinos = EVENTOS[routingKey];
  if (!montarDestinos) return; // evento que não nos interessa

  const status = evento.status ?? STATUS_POR_EVENTO[routingKey];
  const destinos = montarDestinos(evento).filter(Boolean);

  await Promise.all(
    destinos.map(async ({ to, title, body, push = true }) => {
      io.to(room(to)).emit('pedido:status', {
        evento: routingKey,
        pedido_id: evento.pedido_id,
        status,
        title,
        body,
        at: new Date().toISOString(),
      });

      if (push && !(await estaOnline(io, to))) {
        await sendPush(to, {
          title,
          body,
          data: { evento: routingKey, pedido_id: evento.pedido_id, status },
        });
      }
    }),
  );
}
