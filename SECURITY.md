# Politica di sicurezza

## Versioni supportate

Gli aggiornamenti di sicurezza vengono applicati solo all'ultima versione sul branch `main`.

| Versione        | Supportata |
| --------------- | ---------- |
| `main` (ultima) | ✅         |
| precedenti      | ❌         |

## Segnalare una vulnerabilità

**Non aprire issue pubbliche per le vulnerabilità.**

Usa una di queste strade:

1. **GitHub:** scheda _Security_ → _Report a vulnerability_ (segnalazione privata).
2. **Email:** scrivi a **dev.enricojaupi@gmail.com** con oggetto `[SECURITY] Kanban Board`.

Includi, se possibile:

- descrizione del problema e impatto potenziale;
- passi per riprodurlo (richieste, payload, versione di Node.js);
- eventuale proposta di correzione.

## Cosa aspettarsi

- Conferma di ricezione entro **7 giorni**.
- Una prima valutazione e, se la segnalazione è confermata, una correzione il prima possibile.
- Riconoscimento pubblico della segnalazione, se lo desideri, dopo il rilascio della correzione.

## Ambito

Sono di particolare interesse: autenticazione e sessioni, controllo dei permessi sulle board,
validazione degli input, caricamento degli allegati, import/export.
