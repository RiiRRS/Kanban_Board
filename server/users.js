// Elenco degli utenti (per assegnare attività e citare con @)

import express from 'express';
import { db, publicUser } from './db.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY username').all().map(publicUser));
});

export default router;
