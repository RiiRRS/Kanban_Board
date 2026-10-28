// Configurazione da variabili d'ambiente, letta una volta sola

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const flag = (value, fallback) => (value == null ? fallback : /^(1|true|yes)$/i.test(value));

const isProduction = process.env.NODE_ENV === 'production';

const root = fileURLToPath(new URL('..', import.meta.url));
const dbPath = process.env.DB_PATH || path.join(root, 'data', 'kanban.db');

// gli allegati stanno accanto al database (così finiscono nello stesso volume);
// con il database in memoria (test) vanno in una cartella temporanea
function defaultUploadDir() {
  if (dbPath === ':memory:') return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-uploads-'));
  return path.join(path.dirname(dbPath), 'uploads');
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  isProduction,
  // il cookie di sessione viaggia solo su HTTPS (di default in produzione)
  secureCookies: flag(process.env.SECURE_COOKIES, isProduction),
  // dietro nginx o simili: serve per leggere l'IP vero e il protocollo
  trustProxy: process.env.TRUST_PROXY || false,
  // false: nessuno può più registrarsi (l'admin esiste già)
  registrationOpen: flag(process.env.REGISTRATION_OPEN, true),
  // chi si registra con questo username diventa admin (invece del primo utente)
  adminUsername: process.env.ADMIN_USERNAME?.trim() || null,
  // tentativi di login/registrazione ogni 15 minuti per IP
  authRateMax: Number(process.env.AUTH_RATE_MAX) || 20,
  sessionDays: Number(process.env.SESSION_DAYS) || 7,
  uploadDir: process.env.UPLOAD_DIR || defaultUploadDir(),
};
