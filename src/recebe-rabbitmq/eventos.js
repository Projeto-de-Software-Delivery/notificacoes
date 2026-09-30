/**
 * Mapeia cada evento do RabbitMQ para quem deve ser avisado e com qual mensagem.
 * push: false = avisa só pelo WebSocket, sem acordar o celular de quem está offline.
 *
 * Payload esperado: o campo `data` do envelope definido em payloads.md (contrato
 * KAN-13), já desembrulhado pelo consumer antes de chegar aqui — cada função
 * recebe direto `{ pedidoId, clienteId, lojaId, entregadorId?, ... }`.
 *
 * pedido.validado/entrega.aceita/pedido.retirado/pedido.entregue ainda não têm
 * producer real (loja e entregador), e o payloads.md hoje não inclui clienteId/
 * lojaId em todos eles — quando esses eventos passarem a ser publicados de
 * verdade, pode ser preciso revisar o contrato pra garantir que esses campos
 * cheguem aqui.
 */
export const EVENTOS = {
  'pedido.criado': (e) => [
    { to: `loja:${e.lojaId}`, title: 'Novo pedido!', body: `Pedido #${e.pedidoId} aguardando validação.` },
    { to: `cliente:${e.clienteId}`, title: 'Pedido enviado', body: 'Aguardando a loja confirmar.', push: false },
  ],
  'pedido.validado': (e) => [
    { to: `cliente:${e.clienteId}`, title: 'Pedido confirmado', body: 'A loja começou a preparar seu pedido.' },
  ],
  'entrega.aceita': (e) => [
    { to: `cliente:${e.clienteId}`, title: 'Entregador a caminho da loja', body: 'Um entregador aceitou sua corrida.' },
    { to: `loja:${e.lojaId}`, title: 'Entregador definido', body: `Pedido #${e.pedidoId} terá retirada em breve.` },
  ],
  'pedido.retirado': (e) => [
    { to: `cliente:${e.clienteId}`, title: 'Saiu para entrega!', body: 'Seu pedido está a caminho.' },
  ],
  'pedido.entregue': (e) => [
    { to: `cliente:${e.clienteId}`, title: 'Pedido entregue', body: 'Bom apetite!' },
    { to: `loja:${e.lojaId}`, title: 'Pedido finalizado', body: `Pedido #${e.pedidoId} entregue.`, push: false },
    e.entregadorId && { to: `entregador:${e.entregadorId}`, title: 'Corrida concluída', body: `Pedido #${e.pedidoId} finalizado.`, push: false },
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
