# Serviço de Notificações

Parte do app de delivery. Ele **escuta os eventos do pedido no RabbitMQ** e entrega o status atualizado ao app: em tempo real via **WebSocket** (Socket.IO) para quem está com o app aberto, e por **Push Notification** (FCM, que também entrega no iOS via APNs) para quem está com o app fechado.

## Rotas — como chamar

Base: `http://localhost:8080`. `/devices` e `/sessions/me` exigem `Authorization: Bearer <JWT>` (claims `sub` e `role`: `cliente` | `loja` | `entregador`). Veja [como gerar um JWT de teste](#rodando).

**Postman:** importe `postman/servico-notificacoes.postman_collection.json` e rode primeiro **"0. Gerar token (dev)"**. Ele gera o JWT sozinho e as outras rotas já usam esse token. Para simular outro usuário, troque as variáveis `role` e `sub` da collection.

```bash
TOKEN=<seu JWT>

# Healthcheck (sem auth) → 200 {"status":"UP","redis":true} ou 503.
curl http://localhost:8080/health

# Registra o device_token do usuário (após o login) → 201
curl -X POST http://localhost:8080/devices \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"device_token":"abc123"}'

# Remove o device_token (no logout) → 204
curl -X DELETE http://localhost:8080/devices/abc123 \
  -H "Authorization: Bearer $TOKEN"

# Sockets abertos e devices registrados do usuário → 200
curl http://localhost:8080/sessions/me \
  -H "Authorization: Bearer $TOKEN"

# Injeta um evento direto no dispatcher, sem RabbitMQ → 202 (em produção exige o header Authorization)
# routingKey: pedido.criado | pedido.validado | entrega.aceita | pedido.retirado | pedido.entregue
curl -X POST http://localhost:8080/dev/eventos/pedido.validado \
  -H 'Content-Type: application/json' \
  -d '{"pedidoId":10,"clienteId":42,"lojaId":7}'
```

WebSocket (Socket.IO), na mesma porta:

```js
const socket = io('http://localhost:8080', { auth: { token } });
socket.on('pedido:status', (msg) => console.log(msg));
```
....
O serviço tem duas metades bem separadas:

| | Entrada — **RabbitMQ** | Saída — **WebSocket** | Saída — **Push** |
|---|---|---|---|
| O que faz | Escuta os eventos publicados pelos outros serviços | Avisa quem está com o app aberto | Avisa quem está com o app fechado |
| Protocolo | AMQP (exchange topic `pedidos`) | Socket.IO sobre WebSocket | FCM → APNs no iOS |
| Quem fala com ele | Outros serviços (servidor → servidor) | O app do usuário | O celular do usuário |
| Pasta | `src/recebe-rabbitmq/` | `src/envia-websocket/` | `src/envia-push/` |
| Direção | o serviço **recebe** | o serviço **envia** | o serviço **envia** |

No meio delas está o `src/dispatcher.js`: ele pega o evento que veio do RabbitMQ, decide quem deve ser avisado e escolhe o caminho — socket se o usuário está online, push se não está (nunca os dois, para não avisar duas vezes).

```
              ── ENTRADA (RabbitMQ) ──────────────
Serviço Cliente / Loja / Entregador
        │  publica pedido.* / entrega.*
        ▼
   RabbitMQ (exchange topic "pedidos")
        │  fila notificacoes.pedidos
        ▼
 src/recebe-rabbitmq/  ──►  src/dispatcher.js
                                │
                  ── SAÍDA ─────┤
                                ├──►  src/envia-websocket/   app aberto
                                └──►  src/envia-push/        app fechado
```

## Estrutura de pastas

O nome da pasta já diz a direção: `recebe-*` é o que entra, `envia-*` é o que sai.

```
src/
├── recebe-rabbitmq/      ←  RECEBE: escuta os eventos do broker
│   ├── consumer.js           conexão AMQP, fila, DLQ, reconexão
│   └── eventos.js            evento → quem avisar e com qual mensagem
│
├── envia-websocket/      →  ENVIA: tempo real, para quem está com o app aberto
│   └── socket.js             servidor Socket.IO, auth JWT, salas por usuário
│
├── envia-push/           →  ENVIA: notificação, para quem está com o app fechado
│   ├── push.js               FCM (entrega no iOS via APNs)
│   └── devices.js            device_tokens de cada usuário, no Redis
│
├── dispatcher.js            a ponte: pega o que RECEBEU e escolhe por onde ENVIAR
├── redis.js                 cliente Redis (adapter do Socket.IO + devices + healthcheck)
├── config.js                variáveis de ambiente
└── index.js                 sobe o HTTP, o WebSocket e o consumer
```

---

## 1. Entrada: RabbitMQ

Esta metade é só consumo — o serviço **não publica** nada no broker.

- **Exchange:** `pedidos`, tipo `topic`, durável.
- **Fila:** `notificacoes.pedidos`, durável, ligada aos tópicos da tabela abaixo.
- **Erro:** mensagem que falha vai para `notificacoes.pedidos.dlq` (via dead-letter exchange `pedidos.dlx`).
- **Resiliência:** se o broker cair, o consumer reconecta sozinho com backoff.

| Evento (routing key) | Status | Quem é avisado |
|---|---|---|
| `pedido.criado` | AGUARDANDO_VALIDACAO | Loja (push), Cliente (só socket) |
| `pedido.validado` | EM_PREPARO | Cliente |
| `entrega.aceita` | AGUARDANDO_RETIRADA | Cliente, Loja |
| `pedido.retirado` | A_CAMINHO | Cliente |
| `pedido.entregue` | ENTREGUE | Cliente, Loja e Entregador |

A mensagem chega no envelope definido em `payloads.md` (contrato KAN-13), e o `data` precisa trazer os IDs dos envolvidos, já que o serviço não consulta outros bancos (Database-per-Service):

```json
{
  "eventId": "b1f3...",
  "eventType": "pedido.criado",
  "version": 1,
  "occurredAt": "2026-09-30T14:00:00Z",
  "data": { "pedidoId": 10, "clienteId": 42, "lojaId": 7, "entregadorId": 13 }
}
```

Para mudar quem recebe o quê (ou adicionar um evento novo), edite `src/recebe-rabbitmq/eventos.js` — é o único arquivo que liga evento → destinatários. Marque `push: false` num destino quando o aviso for só informativo e não valer acordar o celular.

## 2. Saída: WebSocket

Conexão (Socket.IO), com o mesmo JWT usado no resto do sistema:

```js
const socket = io(URL, { auth: { token } });
socket.on('pedido:status', (msg) => { /* ... */ });
```

Formato do evento `pedido:status`:

```json
{
  "evento": "pedido.validado",
  "pedido_id": 10,
  "status": "EM_PREPARO",
  "title": "Pedido confirmado",
  "body": "A loja começou a preparar seu pedido.",
  "at": "2025-01-01T12:00:00.000Z"
}
```

Como funciona por dentro:

- No handshake o JWT é validado e o socket entra na sala `user:{papel}:{id}` — o envio é sempre por sala, nunca por `socket_id` direto.
- O `user_id` leva o papel na frente (`cliente:42`, `loja:7`, `entregador:13`) para não misturar IDs de domínios diferentes.
- O adapter Redis do Socket.IO permite rodar **várias réplicas**: um evento consumido na réplica A chega num socket conectado na réplica B.

## 3. Saída: Push Notification

O WebSocket só alcança quem está com o app aberto. Se o usuário **não tem nenhum socket conectado**, o mesmo aviso sai por push — nunca os dois ao mesmo tempo.

- Um único cliente FCM cobre Android e iOS (o Firebase repassa para o APNs).
- O app registra o `device_token` em `POST /devices` depois do login e remove em `DELETE /devices/:token` no logout; ficam num SET do Redis (`devices:{user_id}`).
- Token que o FCM responder como inexistente é removido sozinho do registro.
- **Sem credencial do Firebase o serviço roda igual**, só que em modo log: a notificação aparece no console em vez de sair para o celular. Ou seja, dá para desenvolver e demonstrar sem conta nenhuma.

### Push de verdade

1. No console do Firebase, gere uma service account (Configurações do projeto → Contas de serviço).
2. Salve como `firebase.json` na raiz do projeto.
3. Descomente o volume no `docker-compose.yml` e `GOOGLE_APPLICATION_CREDENTIALS` no `.env`.
4. Para iOS, suba a chave `.p8` do APNs no Firebase (Cloud Messaging).

---

## API HTTP

| Método | Rota | Uso |
|---|---|---|
| `GET` | `/health` | Healthcheck (sem auth) |
| `POST` | `/devices` | Registra `{ "device_token": "..." }` depois do login |
| `DELETE` | `/devices/:token` | Remove o token no logout |
| `GET` | `/sessions/me` | Sockets abertos e devices registrados do usuário |
| `POST` | `/dev/eventos/:routingKey` | Injeta um evento direto no dispatcher, pulando o RabbitMQ. Em produção exige JWT |

Todas menos o `/health` exigem `Authorization: Bearer <JWT>`, com as claims `sub` e `role` (`cliente` | `loja` | `entregador`).

---

## Testes

```bash
REDIS_URL=redis://localhost:6379 npm test              # só roda os testes
REDIS_URL=redis://localhost:6379 npm run test:coverage  # roda + exige >= 80% de linha/função
```

Precisa de um Redis real acessível em `REDIS_URL` (os testes de `devices`,
`push` e do servidor Socket.IO usam um de verdade, sem mock — `docker run -d
-p 6379:6379 redis:7-alpine` resolve). `index.js` e `consumer.js` (bootstrap
e conexão AMQP) ficam fora da cobertura medida — quem cobre esses dois é o
job `smoke` do CI, que sobe o serviço inteiro contra RabbitMQ real. O caminho
de push via FCM de verdade (`push.js`, com credencial do Firebase) também
fica fora: sem uma credencial real não dá pra testar sem virar teste de
mentira — o caminho em "modo log" (sem credencial, o que este projeto usa
por padrão) está coberto.

## Rodando

```bash
cp .env.example .env
docker compose up -d --build
```

Sobem três containers: o serviço (porta 8080), o Redis e o RabbitMQ (painel em `http://localhost:15672`, guest/guest).

```bash
docker compose logs -f notificacoes   # espere "[amqp] consumindo notificacoes.pedidos"
curl http://localhost:8080/health
```

Para testar sem o broker, injete um evento direto no dispatcher:

```bash
curl -X POST http://localhost:8080/dev/eventos/pedido.validado \
  -H 'Content-Type: application/json' \
  -d '{"pedidoId":10,"clienteId":42,"lojaId":7}'
```

Para testar o caminho completo, publique no exchange `pedidos` com a routing key do evento
(pelo painel do RabbitMQ ou pelo serviço publicador). Do lado do WebSocket, conecte com
`io(URL, { auth: { token } })` e escute `pedido:status`.

Gerando um JWT de teste:

```bash
docker compose exec notificacoes node -e "import('jsonwebtoken').then(m=>console.log(m.default.sign({role:'cliente',sub:42},'dev-secret-troque-isso')))"
```
