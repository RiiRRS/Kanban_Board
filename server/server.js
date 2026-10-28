import { config } from './config.js';
import { createApp } from './app.js';
import { db } from './db.js';

const server = createApp().listen(config.port, () =>
  console.log(`Kanban Board su http://localhost:${config.port}`),
);

// chiusura ordinata: smette di accettare richieste e chiude il database (checkpoint WAL)
function shutdown(signal) {
  console.log(`${signal}: chiusura in corso`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // i flussi in tempo reale restano aperti per sempre: senza questo la chiusura non finirebbe
  server.closeAllConnections();
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
