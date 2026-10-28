// Aggiornamenti in tempo reale con Server-Sent Events: ogni modifica avvisa tutti i client
// collegati, che poi ricaricano i dati (il messaggio non porta il contenuto).

const clients = new Set();
const PING_MS = 25_000;

export function openStream(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx non deve tenere in coda i messaggi
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.add(res);
  // un messaggio ogni tanto evita che proxy e browser chiudano la connessione inattiva
  const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

export function broadcast(payload = { type: 'change' }) {
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(message);
}

export const streamCount = () => clients.size;
