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

- **Quattro colonne:** Da fare, In corso, In revisione, Fatto.
- **Drag-and-drop** delle card tra le colonne e dentro la stessa colonna; l'ordine resta salvato.
- **Account e sessioni:** registrazione, login e logout; la sessione dura 7 giorni in un cookie
  `HttpOnly`.
- **Attività complete:** titolo, descrizione, data, orario di inizio e fine, colore, priorità.
- **Gerarchie:** ogni attività può avere un'attività genitore (senza cicli).
- **Commenti** su ogni attività, con autore e data.
- **Ricerca e filtri:** testo (ignora maiuscole e accenti), priorità, "Solo urgenti".
- **Scadenze in evidenza:** le attività scadute e quelle di oggi sono segnalate sulla card.
- **Tema chiaro e scuro:** segue il sistema e si può cambiare a mano; la scelta viene ricordata.
- **Scorciatoie da tastiera** per le azioni più comuni.
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
| `npm test`       | esegue i test di `validation.js`                               |
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

| Tasto | Azione                            |
| ----- | --------------------------------- |
| `N`   | Nuova attività                    |
| `/`   | Vai alla ricerca                  |
| `?`   | Mostra l'elenco delle scorciatoie |

## Permessi

| Azione                     | `member`        | `admin`   |
| -------------------------- | --------------- | --------- |
| Vedere attività e commenti | tutte           | tutte     |
| Creare attività e commenti | sì              | sì        |
| **Spostare** un'attività   | qualsiasi       | qualsiasi |
| Modificare un'attività     | solo le proprie | qualsiasi |
| Eliminare un'attività      | solo le proprie | qualsiasi |

Le regole sono applicate dal server: la UI non è l'unica barriera.

## Regole sulle attività

Condivise tra browser e server (`public/js/validation.js`), così i controlli sono identici ovunque.

| Campo       | Regola                                                                     |
| ----------- | -------------------------------------------------------------------------- |
| Username    | 3-30 caratteri: lettere, numeri o `_`; univoco senza distinguere maiuscole |
| Password    | almeno 8 caratteri, salvata con hash `bcrypt`                              |
| Titolo      | 1-100 caratteri                                                            |
| Descrizione | fino a 2000 caratteri                                                      |
| Orario      | la fine deve essere dopo l'inizio                                          |
| Conflitti   | due attività non possono iniziare alla stessa ora nello stesso giorno      |
| Gerarchia   | il genitore deve esistere e non si possono creare cicli                    |
| Commento    | 1-1000 caratteri                                                           |

Eliminando un'attività i suoi commenti vengono cancellati e le figlie restano senza genitore.

## API

Tutte le rotte sotto `/api` rispondono in JSON. Tranne registrazione e login, richiedono la sessione.

| Metodo   | Rotta                         | Descrizione                             |
| -------- | ----------------------------- | --------------------------------------- |
| `POST`   | `/api/register`               | crea un utente e apre la sessione       |
| `POST`   | `/api/login`                  | apre la sessione                        |
| `POST`   | `/api/logout`                 | chiude la sessione                      |
| `GET`    | `/api/me`                     | utente corrente                         |
| `GET`    | `/api/tasks`                  | tutte le attività, ordinate per colonna |
| `POST`   | `/api/tasks`                  | crea un'attività                        |
| `PUT`    | `/api/tasks/:id`              | modifica un'attività (autore o admin)   |
| `PATCH`  | `/api/tasks/:id/move`         | sposta: `{ "status", "position" }`      |
| `DELETE` | `/api/tasks/:id`              | elimina un'attività (autore o admin)    |
| `GET`    | `/api/tasks/:taskId/comments` | commenti di un'attività                 |
| `POST`   | `/api/tasks/:taskId/comments` | aggiunge un commento                    |

Gli errori hanno la forma `{ "error": "messaggio", "field": "campo" }` con il codice HTTP adatto
(`400`, `401`, `403`, `404`, `409`).

## Configurazione

| Variabile | Predefinito      | Significato              |
| --------- | ---------------- | ------------------------ |
| `PORT`    | `3000`           | porta del server         |
| `DB_PATH` | `data/kanban.db` | percorso del file SQLite |

```bash
PORT=8080 DB_PATH=/tmp/demo.db npm start
```

Per ripartire da zero basta fermare il server e cancellare i file `data/kanban.db*`, oppure lanciare
`npm run seed`.

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
