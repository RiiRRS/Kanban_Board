// Alcune richieste vanno confermate dall'utente (conflitto d'orario, limite WIP superato):
// il server risponde 409 con un codice, si chiede e si ripete la richiesta con la conferma.

import { ApiError } from './api.js';
import { confirmDialog } from './ui.js';

// l'utente ha detto di no: non è un errore da mostrare
export class Cancelled extends Error {}

// `send(flags)` esegue la richiesta; ritorna il risultato o lancia Cancelled / ApiError
export async function withConfirmation(send) {
  const flags = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await send(flags);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;

      if (err.code === 'time_conflict' && !flags.ignoreConflicts) {
        const lines = err.details.conflicts.map(
          (c) => `• ${c.title} (${c.startTime}–${c.endTime})`,
        );
        const ok = await confirmDialog(
          `${err.message}.\n\n${lines.join('\n')}\n\nSalvare comunque?`,
          { title: 'Orari sovrapposti', okLabel: 'Salva comunque' },
        );
        if (!ok) throw new Cancelled();
        flags.ignoreConflicts = true;
      } else if (err.code === 'wip_limit' && !flags.force) {
        const ok = await confirmDialog(`${err.message}.\n\nSuperare il limite?`, {
          title: 'Limite WIP raggiunto',
          okLabel: 'Supera il limite',
        });
        if (!ok) throw new Cancelled();
        flags.force = true;
      } else {
        throw err;
      }
    }
  }
  throw new Error('Troppe conferme richieste');
}
