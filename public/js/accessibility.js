// Preferenze di accessibilità: dimensione del testo, contrasto, movimento e focus.
// Sono attributi data-* su <html> (applicati anche da theme-init.js prima del primo disegno).

import { readPrefs, setPref } from './prefs.js';
import { el, button } from './dom.js';
import { openModal } from './ui.js';

const OPTIONS = [
  {
    key: 'text',
    title: 'Dimensione del testo',
    choices: [
      ['normal', 'Normale'],
      ['large', 'Grande'],
      ['xlarge', 'Molto grande'],
    ],
  },
  {
    key: 'contrast',
    title: 'Contrasto',
    choices: [
      ['normal', 'Normale'],
      ['high', 'Alto'],
    ],
  },
  {
    key: 'motion',
    title: 'Animazioni',
    hint: 'Di default si segue l’impostazione del sistema.',
    choices: [
      ['system', 'Come il sistema'],
      ['reduced', 'Ridotte'],
    ],
  },
  {
    key: 'focus',
    title: 'Indicatore del focus',
    hint: 'Evidenzia l’elemento selezionato con la tastiera.',
    choices: [
      ['normal', 'Normale'],
      ['strong', 'Evidenziato'],
    ],
  },
];

function apply(key, value) {
  document.documentElement.dataset[key] = value;
}

export function initAccessibility() {
  const prefs = readPrefs();
  for (const { key, choices } of OPTIONS) apply(key, prefs[key] || choices[0][0]);
}

export function openAccessibility() {
  const root = el('div', 'settings');
  const prefs = readPrefs();

  for (const { key, title, hint, choices } of OPTIONS) {
    const section = el('fieldset', 'detail__section');
    section.append(el('legend', 'detail__section-title', title));
    if (hint) section.append(el('p', 'form-hint', hint));
    const row = el('div', 'settings__row');
    const current = prefs[key] || choices[0][0];
    for (const [value, text] of choices) {
      const label = el('label', 'settings__check');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = `a11y-${key}`;
      radio.checked = value === current;
      radio.addEventListener('change', () => {
        apply(key, value);
        setPref(key, value);
      });
      label.append(radio, text);
      row.append(label);
    }
    section.append(row);
    root.append(section);
  }

  const actions = el('div', 'form-actions');
  actions.append(
    button('Ripristina', 'btn btn--secondary', () => {
      for (const { key, choices } of OPTIONS) {
        apply(key, choices[0][0]);
        setPref(key, choices[0][0]);
      }
      modal.close();
      openAccessibility();
    }),
  );
  root.append(actions);

  const modal = openModal(root, { title: 'Accessibilità', size: 'md' });
}
