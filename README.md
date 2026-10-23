# Kanban Board

Web app Kanban leggera: più utenti si registrano, creano attività, le spostano tra le colonne con il
drag-and-drop, le commentano e le organizzano in gerarchie. I dati sono salvati in un file SQLite
condiviso; il `localStorage` del browser fa solo da cache.

**Gruppo:** Riccardo Righi · Manuel Bertozzi · Enrico Jaupi

## Requisiti

- Node.js 24 LTS (minimo 20)
- Un browser recente (Chrome, Firefox, Safari, Edge)

## Avvio

```bash
git clone https://github.com/RiiRRS/Kanban_Board.git
cd Kanban_Board
npm ci
npm run dev        # http://localhost:3000
npm run seed       # dati di esempio
```

| Comando          | Cosa fa                                      |
| ---------------- | -------------------------------------------- |
| `npm start`      | avvia il server                              |
| `npm run dev`    | avvia il server e lo riavvia a ogni modifica |
| `npm run seed`   | ricrea il database con i dati di esempio     |
| `npm test`       | test di `validation.js`                      |
| `npm run format` | formatta il codice con Prettier              |

## Tecnologie

HTML, CSS e JavaScript vanilla (ES Modules) · Node.js + Express 5 · SQLite (`better-sqlite3`) ·
`bcryptjs` per le password · `cookie-parser` per la sessione.
