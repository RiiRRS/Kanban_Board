// Errori HTTP e gestore unico: ogni errore diventa { error, field }

export class HttpError extends Error {
  constructor(status, message, field = null) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

export const badRequest = (message, field = null) => new HttpError(400, message, field);
export const unauthorized = () => new HttpError(401, 'Devi effettuare il login');
export const forbidden = () => new HttpError(403, 'Non hai i permessi per questa operazione');
export const notFound = (message = 'Attività non trovata') => new HttpError(404, message);
export const conflict = (message, field = null) => new HttpError(409, message, field);

export function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON non valido', field: null });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, field: err.field });
  }
  // rete di sicurezza per due richieste nello stesso istante sullo stesso orario
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({
      error: "Esiste già un'attività che inizia a quell'ora in questo giorno",
      field: 'startTime',
    });
  }
  console.error(err);
  res.status(500).json({ error: 'Errore del server, riprova', field: null });
}
