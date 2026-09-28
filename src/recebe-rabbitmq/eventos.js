/**
 * Mapeia cada evento do RabbitMQ para quem deve ser avisado e com qual mensagem.
 * push: false = avisa só pelo WebSocket, sem acordar o celular de quem está offline.
 *
 * Payload esperado (JSON) — os serviços publicadores devem incluir os IDs
 * dos atores envolvidos, já que este serviço não consulta outros bancos
 * (Database-per-Service):
 *   { pedido_id, cliente_id, loja_id, entregador_id?, status?, ... }
 */
export const EVENTOS = {
  'pedido.criado': (e) => [
    { to: `loja:${e.loja_id}`, title: 'Novo pedido!', body: `Pedido #${e.pedido_id} aguardando validação.` },
    { to: `cliente:${e.cliente_id}`, title: 'Pedido enviado', body: 'Aguardando a loja confirmar.', push: false },
  ],
  'pedido.validado': (e) => [
    { to: `cliente:${e.cliente_id}`, title: 'Pedido confirmado', body: 'A loja começou a preparar seu pedido.' },
  ],
  'entrega.aceita': (e) => [
    { to: `cliente:${e.cliente_id}`, title: 'Entregador a caminho da loja', body: 'Um entregador aceitou sua corrida.' },
    { to: `loja:${e.loja_id}`, title: 'Entregador definido', body: `Pedido #${e.pedido_id} terá retirada em breve.` },
  ],
  'pedido.retirado': (e) => [
    { to: `cliente:${e.cliente_id}`, title: 'Saiu para entrega!', body: 'Seu pedido está a caminho.' },
  ],
  'pedido.entregue': (e) => [
    { to: `cliente:${e.cliente_id}`, title: 'Pedido entregue', body: 'Bom apetite!' },
    { to: `loja:${e.loja_id}`, title: 'Pedido finalizado', body: `Pedido #${e.pedido_id} entregue.`, push: false },
    e.entregador_id && { to: `entregador:${e.entregador_id}`, title: 'Corrida concluída', body: `Pedido #${e.pedido_id} finalizado.`, push: false },
  ],
};

export const TOPICOS = Object.keys(EVENTOS);

// status da máquina de estados que cada evento representa
export const STATUS_POR_EVENTO = {
  'pedido.criado': 'AGUARDANDO_VALIDACAO',
  'pedido.validado': 'EM_PREPARO',
  'entrega.aceita': 'AGUARDANDO_RETIRADA',
  'pedido.retirado': 'A_CAMINHO',
  'pedido.entregue': 'ENTREGUE',
};
