import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 8080),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-troque-isso',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  rabbitUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
  exchange: process.env.RABBITMQ_EXCHANGE ?? 'pedidos',
  queue: process.env.RABBITMQ_QUEUE ?? 'notificacoes.pedidos',
  // Caminho do JSON da service account do Firebase. Sem ele, o push roda em modo "log".
  firebaseCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
};
