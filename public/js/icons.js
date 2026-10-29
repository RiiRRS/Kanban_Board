// Icone SVG a tratto (24×24, colore dal testo): niente emoji, che cambiano aspetto da sistema a sistema

const SVG_NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  x: ['M18 6 6 18', 'M6 6l12 12'],
  plus: ['M12 5v14', 'M5 12h14'],
  check: ['M20 6 9 17l-5-5'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  more: [
    'M5 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
    'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
    'M19 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  ],
  'chevron-left': ['M15 18l-6-6 6-6'],
  'chevron-right': ['M9 18l6-6-6-6'],
  'arrow-left': ['M19 12H5', 'M12 19l-7-7 7-7'],
  'arrow-right': ['M5 12h14', 'M12 5l7 7-7 7'],
  settings: [
    'M4 21v-7',
    'M4 10V3',
    'M12 21v-9',
    'M12 8V3',
    'M20 21v-5',
    'M20 12V3',
    'M2 14h4',
    'M10 8h4',
    'M18 16h4',
  ],
  board: [
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'M8 7v7',
    'M12 7v4',
    'M16 7v9',
  ],
  calendar: [
    'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    'M16 2v4',
    'M8 2v4',
    'M3 10h18',
  ],
  chart: ['M3 3v18h18', 'M8 17v-5', 'M13 17V8', 'M18 17v-3'],
  history: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l4 2'],
  accessibility: [
    'M12 4a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
    'M5 8l7 1 7-1',
    'M12 9v4',
    'M9 20l3-7 3 7',
  ],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M12 2v2',
    'M12 20v2',
    'M4.93 4.93l1.41 1.41',
    'M17.66 17.66l1.41 1.41',
    'M2 12h2',
    'M20 12h2',
    'M6.34 17.66l-1.41 1.41',
    'M19.07 4.93l-1.41 1.41',
  ],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z'],
  checklist: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  subtasks: ['M15 10l5 5-5 5', 'M4 4v7a4 4 0 0 0 4 4h12'],
  parent: ['M14 9 9 4 4 9', 'M20 20h-7a4 4 0 0 1-4-4V4'],
  repeat: [
    'M17 2l4 4-4 4',
    'M3 11v-1a4 4 0 0 1 4-4h14',
    'M7 22l-4-4 4-4',
    'M21 13v1a4 4 0 0 1-4 4H3',
  ],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'],
  paperclip: [
    'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48',
  ],
  link: [
    'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
    'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  ],
  user: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
  at: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8'],
  comment: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
};

// <svg> decorativo: il significato lo danno il testo accanto o l'aria-label del bottone
export function icon(name, className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon${className ? ` ${className}` : ''}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of PATHS[name] ?? []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

// elementi statici dell'HTML: <span data-icon="nome"></span>
export function hydrateIcons(root = document) {
  for (const node of root.querySelectorAll('[data-icon]')) {
    node.replaceChildren(icon(node.dataset.icon));
  }
}
