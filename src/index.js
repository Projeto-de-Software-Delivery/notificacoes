import http from 'node:http';
import express from 'express';
import { config } from './config.js';
import { redis } from './redis.js';
import { dispatch } from './dispatcher.js';
import { startConsumer } from './recebe-rabbitmq/consumer.js';
import { TOPICOS } from './recebe-rabbitmq/eventos.js';
import { createSocketServer, userIdFromToken, room } from './envia-websocket/socket.js';
import { devices } from './envia-push/devices.js';

const app = express();
app.use(express.json());

const server = http.createServer(app);

// Lado que ENVIA: servidor WebSocket no mesmo servidor HTTP.
const io = createSocketServer(server);

// Lado que RECEBE: cada evento do RabbitMQ vai para o dispatcher.
startConsumer((routingKey, evento) => dispatch(io, routingKey, evento));

// Autenticação por JWT (o mesmo token que o API Gateway valida).
function auth(req, res, next) {
  try {
    req.userId = userIdFromToken(req.headers.authorization?.replace(/^Bearer /, ''));
    next();
  } catch {
    res.status(401).json({ erro: 'não autorizado' });
  }
}

app.get('/health', async (_req, res) => {
  // Com o Redis fora do ar o ioredis enfileira o comando para sempre; o timeout
  // faz o /health responder DOWN em vez de travar a requisição.
  const timeout = new Promise((r) => setTimeout(r, 2000, null));
  const redisOk = (await Promise.race([redis.ping().catch(() => null), timeout])) === 'PONG';
  res.status(redisOk ? 200 : 503).json({ status: redisOk ? 'UP' : 'DOWN', redis: redisOk });
});

// O app registra o device_token do FCM/APNs no login e remove no logout.
app.post('/devices', auth, async (req, res) => {
  const { device_token } = req.body ?? {};
  if (!device_token) return res.status(400).json({ erro: 'device_token é obrigatório' });
  await devices.add(req.userId, device_token);
  res.status(201).json({ user_id: req.userId, device_token });
});

app.delete('/devices/:token', auth, async (req, res) => {
  await devices.remove(req.userId, req.params.token);
  res.status(204).end();
});

// O que o usuário tem agora: sockets abertos e aparelhos registrados.
app.get('/sessions/me', auth, async (req, res) => {
  const sockets = await io.in(room(req.userId)).fetchSockets();
  res.json({
    user_id: req.userId,
    socket_ids: sockets.map((s) => s.id),
    device_tokens: await devices.list(req.userId),
  });
});

// Atalho de desenvolvimento: injeta um evento sem passar pelo RabbitMQ.
if (process.env.NODE_ENV !== 'production') {
  app.post('/dev/eventos/:routingKey', async (req, res) => {
    const { routingKey } = req.params;
    if (!TOPICOS.includes(routingKey)) {
      return res.status(404).json({ erro: 'tópico desconhecido', topicos: TOPICOS });
    }
    await dispatch(io, routingKey, req.body);
    res.status(202).json({ ok: true });
  });
}

server.listen(config.port, () => console.log(`[http] Serviço Notificações na porta ${config.port}`));

const encerrar = () => {
  io.close();
  server.close(() => redis.quit().finally(() => process.exit(0)));
};
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);
