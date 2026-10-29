<div align="center">

# Kanban Board

**Organizza il lavoro di squadra su una lavagna a colonne: crea, trascina, commenta.**

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2020-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES%20Modules-F7DF1E?logo=javascript&logoColor=black)
![Dipendenze frontend](https://img.shields.io/badge/frontend-zero%20dipendenze-4f8cff)

</div>

Web app Kanban leggera: più utenti si registrano, creano attività, le spostano tra le colonne con il
drag-and-drop, le commentano e le organizzano in gerarchie. I dati sono salvati in un file SQLite
condiviso; il `localStorage` del browser fa solo da cache.

**Gruppo:** Riccardo Righi · Manuel Bertozzi · Enrico Jaupi

## Indice

- [Funzionalità](#funzionalità)
- [Avvio rapido](#avvio-rapido)
- [Utenti di prova](#utenti-di-prova)
- [Scorciatoie da tastiera](#scorciatoie-da-tastiera)
- [Permessi](#permessi)
- [Regole sulle attività](#regole-sulle-attività)
- [API](#api)
- [Configurazione](#configurazione)
- [Test e formattazione](#test-e-formattazione)

## Funzionalità

- **Più board**, ognuna con le sue colonne, etichette e attività; si passa dall'una all'altra dal
  selettore nella barra laterale. **Colonne personalizzabili** (aggiungi, rinomina, riordina, elimina) con
  **limite WIP** opzionale: oltre il limite serve una conferma esplicita.
- **Drag-and-drop** delle card tra le colonne e dentro la stessa colonna; l'ordine resta salvato.
- **Account e sessioni:** registrazione, login e logout; la sessione dura 7 giorni in un cookie
  `HttpOnly`. **Profilo** con nome visualizzato, colore dell'avatar e cambio password.
- **Attività complete:** titolo, descrizione in **Markdown**, data, orario, colore, priorità,
  **assegnatari** (anche più di uno), **etichette** colorate, **stima e tempo effettivo**,
  **ripetizione** (giornaliera, settimanale, mensile).
- **Checklist** con barra di avanzamento e **allegati** (link e file fino a 5 MB).
- **Gerarchie:** ogni attività può avere un'attività genitore (senza cicli); il genitore mostra
  quante sotto-attività sono completate.
- **Commenti** con **@menzioni**, modificabili ed eliminabili dall'autore.
- **Notifiche in-app:** assegnazioni, menzioni, commenti sulle tue attività e scadenze del giorno.
- **Avvisi sui conflitti d'orario:** se due attività della stessa persona si sovrappongono si
  chiede conferma, ma si può salvare lo stesso.
- **Cronologia** di ogni attività e registro di tutta la board.
- **Viste:** board, **calendario** (mese e settimana), **dashboard** con statistiche e **attività**.
- **Archivio:** le attività completate si archiviano (anche tutte insieme) e si ripristinano.
- **Export** in JSON e CSV, **import** di una board da JSON.
- **Aggiornamenti in tempo reale:** le modifiche degli altri compaiono senza ricaricare.
- **Ricerca e filtri:** testo (ignora maiuscole e accenti), priorità, etichetta, "Solo miei",
  "Solo urgenti".
- **Vista compatta**, **tema chiaro e scuro**, **scorciatoie da tastiera**.
- **Cache locale:** il browser ricorda l'ultimo stato per una partenza immediata.

## Avvio rapido

Servono **Node.js 24 LTS** (minimo 20) e un browser recente (Chrome, Firefox, Safari, Edge).

```bash
git clone https://github.com/RiiRRS/Kanban_Board.git
cd Kanban_Board
npm ci
npm run seed       # facoltativo: dati di esempio
npm run dev        # http://localhost:3000
```

Il database viene creato da solo in `data/kanban.db` al primo avvio. Se non fai il seed, il **primo
utente che si registra diventa `admin`**.

| Comando          | Cosa fa                                                        |
| ---------------- | -------------------------------------------------------------- |
| `npm start`      | avvia il server                                                |
| `npm run dev`    | avvia il server e lo riavvia a ogni modifica                   |
| `npm run seed`   | ricrea il database con i dati di esempio (**cancella i dati**) |
| `npm test`       | esegue i test (validazione e API)                              |
| `npm run format` | formatta il codice con Prettier                                |

## Utenti di prova

Dopo `npm run seed` ci sono tre utenti, tutti con password `password123`:

| Username   | Ruolo    |
| ---------- | -------- |
| `enrico`   | `admin`  |
| `riccardo` | `member` |
| `manuel`   | `member` |

Il seed crea anche 10 attività (con una gerarchia) e 4 commenti, con date calcolate rispetto a oggi.
Per provare i permessi apri due sessioni: una finestra normale e una in incognito.

## Scorciatoie da tastiera

Non si attivano mentre scrivi in un campo o con una finestra aperta, e non interferiscono con
Ctrl, Alt e Cmd.

| Tasto           | Azione                                         |
| --------------- | ---------------------------------------------- |
| `N`             | Nuova attività                                 |
| `/`             | Vai alla ricerca                               |
| `1` `2` `3` `4` | Board, calendario, dashboard, attività         |
| `C`             | Vista compatta                                 |
| `T`             | Tema chiaro/scuro                              |
| `?`             | Mostra l'elenco delle scorciatoie              |
| Frecce          | Muoviti tra le card (con una card selezionata) |
| `Invio`         | Apri la card selezionata                       |
| `E`             | Modifica la card selezionata                   |
| `[` `]`         | Sposta la card nella colonna prima/dopo        |
| `A`             | Archivia (o ripristina) la card selezionata    |

## Permessi

| Azione                                                            | `member`                   | `admin`       |
| ----------------------------------------------------------------- | -------------------------- | ------------- |
| Vedere board, attività e commenti                                 | tutte                      | tutte         |
| Creare attività, commenti ed etichette                            | sì                         | sì            |
| **Spostare**, **archiviare** un'attività                          | qualsiasi                  | qualsiasi     |
| Modificare o eliminare un'attività                                | solo le proprie            | qualsiasi     |
| Checklist, allegati, tempo effettivo                              | proprie e quelle assegnate | qualsiasi     |
| Modificare un commento                                            | solo i propri              | solo i propri |
| Eliminare un commento                                             | solo i propri              | qualsiasi     |
| Rinominare/eliminare una board, gestire le colonne e le etichette | solo quelle create da te   | qualsiasi     |
| Creare o importare una board                                      | sì                         | sì            |

Le regole sono applicate dal server: la UI non è l'unica barriera.

## Regole sulle attività

Condivise tra browser e server (`public/js/validation.js`), così i controlli sono identici ovunque.

| Campo       | Regola                                                                       |
| ----------- | ---------------------------------------------------------------------------- |
| Username    | 3-30 caratteri: lettere, numeri o `_`; univoco senza distinguere maiuscole   |
| Password    | almeno 8 caratteri, salvata con hash `bcrypt`                                |
| Titolo      | 1-100 caratteri                                                              |
| Descrizione | fino a 5000 caratteri, Markdown                                              |
| Orario      | la fine deve essere dopo l'inizio                                            |
| Conflitti   | avviso (non blocco) se si sovrappone a un'attività aperta di un assegnatario |
| Gerarchia   | il genitore deve esistere, stare nella stessa board e non si creano cicli    |
| Limite WIP  | oltre il limite della colonna serve una conferma (`force`)                   |
| Stima/tempo | minuti interi, da 0 a 99999                                                  |
| Commento    | 1-1000 caratteri                                                             |
| Allegati    | link `http(s)` o file fino a 5 MB, al massimo 30 per attività                |

Un conflitto d'orario riguarda attività dello stesso giorno con orari che si incrociano e almeno un
assegnatario in comune; contano solo quelle non completate né archiviate. Senza assegnatari non c'è
mai conflitto.

Completando un'attività ricorrente (spostandola in una colonna "completata") nasce la prossima
occorrenza nella prima colonna, con la checklist azzerata; accade una volta sola per attività.

Eliminando un'attività i suoi commenti, la checklist e gli allegati vengono cancellati e le figlie
restano senza genitore.

## API

Tutte le rotte sotto `/api` rispondono in JSON. Tranne registrazione e login, richiedono la sessione.

| Metodo   | Rotta                               | Descrizione                                                      |
| -------- | ----------------------------------- | ---------------------------------------------------------------- |
| `POST`   | `/api/register`, `/api/login`       | crea un utente / apre la sessione                                |
| `POST`   | `/api/logout`                       | chiude la sessione                                               |
| `GET`    | `/api/me`                           | utente corrente                                                  |
| `PATCH`  | `/api/me`                           | nome visualizzato e colore dell'avatar                           |
| `POST`   | `/api/me/password`                  | cambia password (chiude le altre sessioni)                       |
| `GET`    | `/api/users`                        | elenco utenti                                                    |
| `GET`    | `/api/boards`                       | elenco board                                                     |
| `POST`   | `/api/boards`                       | crea una board con le colonne predefinite                        |
| `POST`   | `/api/boards/import`                | crea una board da un export JSON                                 |
| `GET`    | `/api/boards/:id`                   | board con colonne ed etichette                                   |
| `PUT`    | `/api/boards/:id`                   | rinomina                                                         |
| `DELETE` | `/api/boards/:id`                   | elimina (non l'ultima)                                           |
| `GET`    | `/api/boards/:id/tasks`             | attività; `?archived=1` per l'archivio                           |
| `GET`    | `/api/boards/:id/events`            | cronologia (`?limit=`, `?before=`)                               |
| `GET`    | `/api/boards/:id/stats`             | statistiche per la dashboard                                     |
| `GET`    | `/api/boards/:id/export`            | export JSON; `?format=csv` per il CSV                            |
| `POST`   | `/api/boards/:id/archive-done`      | archivia le attività completate                                  |
| `POST`   | `/api/boards/:id/columns`           | aggiunge una colonna `{ name, wipLimit, isDone }`                |
| `PUT`    | `/api/boards/:id/columns/:columnId` | modifica una colonna                                             |
| `PUT`    | `/api/boards/:id/columns-order`     | riordina `{ ids }`                                               |
| `DELETE` | `/api/boards/:id/columns/:columnId` | elimina; con attività dentro serve `?moveTo=ID`                  |
| `POST`   | `/api/boards/:id/labels`            | crea un'etichetta; `PUT`/`DELETE` su `/labels/:labelId`          |
| `POST`   | `/api/tasks`                        | crea un'attività                                                 |
| `GET`    | `/api/tasks/:id`                    | dettaglio con checklist e allegati                               |
| `PUT`    | `/api/tasks/:id`                    | modifica (autore o admin)                                        |
| `PATCH`  | `/api/tasks/:id/move`               | sposta: `{ "columnId", "position" }`                             |
| `POST`   | `/api/tasks/:id/archive`            | archivia o ripristina: `{ "archived": true\|false }`             |
| `PATCH`  | `/api/tasks/:id/time`               | tempo effettivo `{ "spentMin" }`                                 |
| `DELETE` | `/api/tasks/:id`                    | elimina (autore o admin)                                         |
| `GET`    | `/api/tasks/:id/events`             | cronologia dell'attività                                         |
| `POST`   | `/api/tasks/:id/checklist`          | aggiunge una voce; `PUT`/`DELETE` su `/checklist/:itemId`        |
| `POST`   | `/api/tasks/:id/attachments`        | link (JSON `{ url, name }`) o file (corpo grezzo + `X-Filename`) |
| `GET`    | `/api/attachments/:id/download`     | scarica un file allegato                                         |
| `DELETE` | `/api/attachments/:id`              | elimina un allegato                                              |
| `GET`    | `/api/tasks/:taskId/comments`       | commenti di un'attività                                          |
| `POST`   | `/api/tasks/:taskId/comments`       | aggiunge un commento                                             |
| `PUT`    | `/api/tasks/:taskId/comments/:id`   | modifica (solo l'autore)                                         |
| `DELETE` | `/api/tasks/:taskId/comments/:id`   | elimina (autore o admin)                                         |
| `GET`    | `/api/notifications`                | notifiche dell'utente e contatore delle non lette                |
| `POST`   | `/api/notifications/read`           | segna come lette: `{ "ids": [...] }` o `{ "all": true }`         |
| `GET`    | `/api/stream`                       | flusso Server-Sent Events: un messaggio a ogni modifica          |

Le richieste di creazione, modifica e spostamento accettano anche le conferme dell'utente:
`ignoreConflicts: true` (orari sovrapposti) e `force: true` (limite WIP superato).

Gli errori hanno la forma `{ "error": "messaggio", "field": "campo" }` con il codice HTTP adatto
(`400`, `401`, `403`, `404`, `409`, `413`). Le richieste da confermare rispondono `409` con un
campo `code` aggiuntivo: `time_conflict` (con l'elenco `conflicts`), `wip_limit`, `column_not_empty`.

## Configurazione

| Variabile           | Predefinito          | Significato                                                                                                                            |
| ------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`              | `3000`               | porta del server                                                                                                                       |
| `DB_PATH`           | `data/kanban.db`     | percorso del file SQLite                                                                                                               |
| `NODE_ENV`          | —                    | `production` attiva il cookie `Secure`                                                                                                 |
| `SECURE_COOKIES`    | `true` in produzione | cookie di sessione solo su HTTPS                                                                                                       |
| `TRUST_PROXY`       | —                    | es. `1` se c'è nginx davanti (IP e protocollo corretti)                                                                                |
| `REGISTRATION_OPEN` | `true`               | `false` chiude le registrazioni (resta solo il primo utente)                                                                           |
| `ADMIN_USERNAME`    | —                    | chi si registra con questo username è admin (invece del primo utente). Con le registrazioni aperte, registrati subito tu con quel nome |
| `SESSION_DAYS`      | `7`                  | durata della sessione                                                                                                                  |
| `UPLOAD_DIR`        | accanto al database  | cartella dei file allegati (`data/uploads`)                                                                                            |
| `AUTH_RATE_MAX`     | `20`                 | tentativi di login/registrazione ogni 15 minuti per IP                                                                                 |

```bash
PORT=8080 DB_PATH=/tmp/demo.db npm start
```

Per ripartire da zero basta fermare il server e cancellare i file `data/kanban.db*`, oppure lanciare
`npm run seed` (se il database ha già utenti serve `npm run seed -- --force`).

### Health check e migrazioni

`GET /health` risponde `{ "status": "ok" }`. Le modifiche allo schema
del database sono migrazioni numerate in `server/db.js` (`PRAGMA user_version`): un database creato
con una versione precedente viene aggiornato da solo all'avvio, senza perdere dati (gli stati fissi
diventano le colonne della "Board principale"). Il test `server/migration.test.js` lo verifica.

### Sicurezza

Header CSP e simili su ogni risposta, limite di tentativi su login/registrazione, token di sessione
salvati come hash, e le richieste che modificano dati devono avere l'header `X-Requested-With:
kanban` (protezione CSRF).

## Test e formattazione

```bash
npm test               # test runner integrato di Node (node --test)
npm run format         # Prettier: riscrive i file
npx prettier --check . # solo verifica
```

Lo stile è definito da `.prettierrc` e `.editorconfig`.

## Tecnologie

HTML, CSS e JavaScript vanilla (ES Modules) · Node.js + Express 5 · SQLite (`better-sqlite3`) ·
`bcryptjs` per le password · `cookie-parser` per la sessione.
