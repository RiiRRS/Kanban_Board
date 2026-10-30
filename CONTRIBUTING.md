# Come contribuire

Grazie per l'interesse verso Kanban Board! Questa guida spiega come proporre modifiche.
Partecipando accetti il [Codice di condotta](CODE_OF_CONDUCT.md).

## Segnalare un bug o proporre un'idea

- Cerca prima tra le [issue](https://github.com/RiiRRS/Kanban_Board/issues) esistenti.
- Apri una nuova issue usando il modello **Segnalazione bug** o **Richiesta di funzionalità**.
- Le vulnerabilità di sicurezza **non** vanno segnalate con issue pubbliche: vedi
  [SECURITY.md](SECURITY.md).

## Preparare l'ambiente

Requisiti: **Node.js ≥ 20**.

```bash
git clone https://github.com/RiiRRS/Kanban_Board.git
cd Kanban_Board
npm install
npm run seed   # opzionale: dati e utenti di prova
npm run dev    # avvio con ricaricamento automatico
```

## Flusso di lavoro

1. Crea un branch a partire da `main` con un nome descrittivo, ad esempio
   `fix/drag-colonna-vuota` o `feat/filtro-scadenze`.
2. Fai modifiche piccole e mirate: una pull request per argomento.
3. Prima di aprire la PR esegui:
   ```bash
   npm test
   npm run format:check   # oppure npm run format per correggere
   ```
4. Apri la pull request verso `main` compilando il modello e collegando l'issue
   (`Closes #123`).

## Stile del codice

- Lo stile è definito da `.prettierrc` e `.editorconfig` (2 spazi, apici singoli, righe da 100
  caratteri).
- Frontend in JavaScript vanilla con ES Modules: niente dipendenze né build step nel frontend.
- La validazione condivisa sta in `public/js/validation.js` e `public/js/constants.js`: se cambi una
  regola, aggiornala lì, così client e server restano allineati.
- Aggiungi o aggiorna i test in `server/` quando modifichi le API o le regole sulle attività.

## Messaggi di commit

Scrivi messaggi in italiano, brevi, che descrivano cosa cambia e perché
(es. `Corregge l'ordine delle card dopo il filtro per etichetta`).

## Documentazione

Se la modifica cambia funzionalità, API, permessi o configurazione, aggiorna anche il
[README](README.md).
