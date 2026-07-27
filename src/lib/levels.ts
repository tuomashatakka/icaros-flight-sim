export type LevelMeta = {
  id:      string;
  name:    string;
  tagline: string;

  /** Menu card gradient, as `[from, to]` colours fed straight to CSS. */
  accent: [string, string];
}

export const LEVELS: LevelMeta[] = [
  {
    id:      'flats',
    name:    'The Flats',
    tagline: 'A flat proving ground — learn the controls, tune the handling, stay on the deck.',
    accent:  [ 'hsl(199 89% 60% / 0.3)', 'hsl(243 75% 40% / 0.1)' ],
  },
  {
    id:      'procedural',
    name:    'Origin Circuit',
    tagline: 'The proving ground — branching routes, a shortcut jump, reflective tarmac.',
    accent:  [ 'hsl(292 84% 61% / 0.3)', 'hsl(272 72% 40% / 0.1)' ],
  },
  {
    id:      'neon-canyon',
    name:    'Neon Canyon',
    tagline: 'A winding ravine lit by emissive rails, banked turns and a leap across the gap.',
    accent:  [ 'hsl(350 89% 60% / 0.3)', 'hsl(21 90% 48% / 0.1)' ],
  },
  {
    id:      'orbital-ring',
    name:    'Orbital Ring',
    tagline: 'A banked figure-eight station suspended in the starfield above the planet.',
    accent:  [ 'hsl(187 86% 53% / 0.3)', 'hsl(201 90% 35% / 0.1)' ],
  },
]

export const isLevelId = (id: string) => LEVELS.some(l => l.id === id)
