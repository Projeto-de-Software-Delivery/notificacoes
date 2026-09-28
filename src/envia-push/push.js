import fs from 'node:fs';
// API modular: nas versões novas o default import não traz mais admin.credential.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { config } from '../config.js';
import { devices } from './devices.js';

// O FCM entrega tanto em Android quanto em iOS (ele repassa para o APNs),
// então um único cliente cobre os dois.
let messaging = null;

if (config.firebaseCredentials && fs.existsSync(config.firebaseCredentials)) {
  // Credencial vazia/inválida não derruba o serviço: o WebSocket continua funcionando.
  try {
    initializeApp({ credential: applicationDefault() });
    messaging = getMessaging();
    console.log('[push] FCM habilitado');
  } catch (err) {
    console.error(`[push] credencial do Firebase inválida (${err.message}) — push em modo log`);
  }
} else {
  console.log('[push] sem credenciais do Firebase — push em modo log');
}

// Erros que significam "esse token não existe mais": removemos do registro.
const TOKEN_INVALIDO = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/** Manda a notificação para todos os aparelhos do usuário. */
export async function sendPush(userId, { title, body, data = {} }) {
  const tokens = await devices.list(userId);
  if (tokens.length === 0) return { sent: 0 };

  // Sem credencial do Firebase o serviço roda igual, só imprime no console.
  if (!messaging) {
    console.log(`[push:log] ${userId} (${tokens.length} device(s)): ${title} — ${body}`);
    return { sent: tokens.length, dryRun: true };
  }

  const res = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    // data do FCM só aceita strings
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    apns: { payload: { aps: { sound: 'default' } } },
    android: { priority: 'high' },
  });

  // tokens que o FCM disse que não existem mais saem do registro
  for (const [i, r] of res.responses.entries()) {
    if (!r.success && TOKEN_INVALIDO.has(r.error?.code)) {
      await devices.remove(userId, tokens[i]);
    }
  }

  return { sent: res.successCount, failed: res.failureCount };
}
