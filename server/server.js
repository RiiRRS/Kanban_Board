// SEGNAPOSTO
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));
app.listen(PORT, () => console.log(`Kanban Board su http://localhost:${PORT}`));
