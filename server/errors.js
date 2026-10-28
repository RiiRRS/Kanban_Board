// Errori HTTP e gestore unico: ogni errore diventa { error, field } (più eventuali campi extra)

export class HttpError extends Error {
  constructor(status, message, field = null, extra = null) {
    super(message);
    this.status = status;
    this.field = field;
    this.extra = extra;
  }
}

export const badRequest = (message, field = null) => new HttpError(400, message, field);
export const unauthorized = () => new HttpError(401, 'Devi effettuare il login');
export const forbidden = () => new HttpError(403, 'Non hai i permessi per questa operazione');
export const notFound = (message = 'Attività non trovata') => new HttpError(404, message);
export const conflict = (message, field = null, extra = null) =>
  new HttpError(409, message, field, extra);

export function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON non valido', field: null });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Richiesta troppo grande', field: null });
  }
  if (err instanceof HttpError) {
    return res
      .status(err.status)
      .json({ error: err.message, field: err.field, ...(err.extra ?? {}) });
  }
  if (!process.env.QUIET_ERRORS) console.error(err);
  res.status(500).json({ error: 'Errore del server, riprova', field: null });
}
