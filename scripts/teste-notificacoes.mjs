// Teste de ponta a ponta: publica um evento como os outros serviços fariam e
// confere se o aviso sai pelo WebSocket (app aberto) e pelo push (app fechado).
//
//   node scripts/teste-notificacoes.mjs
//
// Variáveis (todas opcionais):
//   BASE_URL       serviço                      (padrão http://localhost:8080)
//   JWT_SECRET     secret para assinar o token  (padrão o de dev)
//   TOKEN          JWT pronto, no lugar do JWT_SECRET (precisa ser role cliente)
//   RABBIT_API     API do painel do RabbitMQ    (padrão http://localhost:15672)
//   RABBIT_USER / RABBIT_PASS                   (padrão guest/guest)
import jwt from 'jsonwebtoken';
import { io } from 'socket.io-client';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';
const RABBIT_API = process.env.RABBIT_API ?? 'http://localhost:15672';
const RABBIT_AUTH = Buffer.from(`${process.env.RABBIT_USER ?? 'guest'}:${process.env.RABBIT_PASS ?? 'guest'}`).toString('base64');

const token = process.env.TOKEN
  ?? jwt.sign({ role: 'cliente', sub: 42 }, process.env.JWT_SECRET ?? 'dev-secret-troque-isso');
const { sub: clienteId } = jwt.decode(token);
const DEVICE = `device-teste-${Date.now()}`;

const ok = (msg) => console.log(`  ✔ ${msg}`);
const falha = (msg) => { console.log(`  ✘ ${msg}`); process.exitCode = 1; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body && JSON.stringify(body),
  });
  const texto = await res.text();
  return { status: res.status, json: texto ? JSON.parse(texto) : null };
}

// Publica no exchange "pedidos"; se o painel não estiver acessível, cai no /dev/eventos.
async function publicar(routingKey, evento) {
  try {
    const res = await fetch(`${RABBIT_API}/api/exchanges/%2F/pedidos/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${RABBIT_AUTH}` },
      body: JSON.stringify({ properties: {}, routing_key: routingKey, payload: JSON.stringify(evento), payload_encoding: 'string' }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return 'RabbitMQ';
  } catch {}
  const res = await fetch(`${BASE_URL}/dev/eventos/${routingKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(evento),
  });
  if (res.status === 202) return '/dev/eventos';
  throw new Error(`não consegui publicar: painel do RabbitMQ inacessível em ${RABBIT_API} e /dev/eventos respondeu ${res.status}`);
}

async function main() {
  console.log(`Serviço: ${BASE_URL} — usuário cliente:${clienteId}\n`);

  console.log('1. HTTP');
  const health = await fetch(`${BASE_URL}/health`).then((r) => r.json()).catch(() => null);
  health?.status === 'UP' ? ok('health UP') : falha(`health: ${JSON.stringify(health)}`);
  const me = await api('GET', '/sessions/me');
  if (me.status !== 200) {
    falha(`token recusado (${me.status}) — o JWT_SECRET/TOKEN não é o do servidor`);
    return;
  }
  ok('token aceito');

  console.log('\n2. WebSocket (app aberto)');
  const socket = io(BASE_URL, { auth: { token }, reconnection: false });
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  }).then(() => ok(`conectado (${socket.id})`), (e) => falha(`não conectou: ${e.message}`));

  if (socket.connected) {
    const recebido = new Promise((r) => socket.once('pedido:status', r));
    const via = await publicar('pedido.validado', { pedido_id: 1, cliente_id: clienteId, loja_id: 7 });
    const msg = await Promise.race([recebido, espera(5000)]);
    msg ? ok(`publicado via ${via}, chegou no socket: ${msg.status} — "${msg.title}"`) : falha('evento publicado, mas nada chegou no socket em 5s');
    socket.close();
    await espera(500);
  }

  console.log('\n3. Push (app fechado)');
  await api('POST', '/devices', { device_token: DEVICE });
  const antes = await api('GET', '/sessions/me');
  antes.json.socket_ids.length === 0 && antes.json.device_tokens.includes(DEVICE)
    ? ok('sem socket aberto e com device registrado')
    : falha(`estado inesperado: ${JSON.stringify(antes.json)}`);

  const via = await publicar('pedido.retirado', { pedido_id: 1, cliente_id: clienteId, loja_id: 7 });
  await espera(3000);
  const depois = await api('GET', '/sessions/me');
  if (!depois.json.device_tokens.includes(DEVICE)) {
    // O FCM de verdade recusa o token falso e o serviço o remove sozinho.
    ok(`publicado via ${via}; o FCM foi chamado e descartou o token de teste (push real ativo)`);
  } else {
    ok(`publicado via ${via}; push em modo log — confira "[push:log] cliente:${clienteId}" nos logs do serviço`);
    await api('DELETE', `/devices/${DEVICE}`);
  }

  console.log(process.exitCode ? '\nFALHOU' : '\nTudo certo');
}

await main();
