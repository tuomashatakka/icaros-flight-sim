export type LevelMeta = {
  id: string;
  name: string;
  tagline: string;
  /** Tailwind gradient classes for the menu card accent. */
  accent: string;
};

export const LEVELS: LevelMeta[] = [
  {
    id: 'flats',
    name: 'The Flats',
    tagline: 'A flat proving ground — learn the controls, tune the handling, stay on the deck.',
    accent: 'from-sky-400/30 to-indigo-700/10',
  },
  {
    id: 'procedural',
    name: 'Origin Circuit',
    tagline: 'The proving ground — branching routes, a shortcut jump, reflective tarmac.',
    accent: 'from-fuchsia-500/30 to-purple-700/10',
  },
  {
    id: 'neon-canyon',
    name: 'Neon Canyon',
    tagline: 'A winding ravine lit by emissive rails, banked turns and a leap across the gap.',
    accent: 'from-rose-500/30 to-orange-600/10',
  },
  {
    id: 'orbital-ring',
    name: 'Orbital Ring',
    tagline: 'A banked figure-eight station suspended in the starfield above the planet.',
    accent: 'from-cyan-400/30 to-sky-700/10',
  },
];

export const isLevelId = (id: string) => LEVELS.some((l) => l.id === id);
