/**
 * Reading fonts for note content. Every family here is bundled locally in
 * public/fonts (see src/index.css @font-face) so choices work offline and
 * in the installed PWA — the previous menu referenced Merriweather and
 * JetBrains Mono stacks that were never loaded anywhere, so selecting them
 * silently fell back to a system font.
 *
 * Settings persist the stable `id`, never a CSS stack, so stacks can evolve
 * and legacy stored stacks can be migrated deterministically.
 */
export interface ReadingFont {
  id: string;
  name: string;
  desc: string;
  stack: string;
}

export const READING_FONTS: ReadingFont[] = [
  {
    id: 'google-sans',
    name: 'Google Sans',
    desc: 'Default · clean and modern for everything',
    stack: "'Google Sans', 'Google Sans Text', system-ui, -apple-system, 'Segoe UI', sans-serif"
  },
  {
    id: 'source-serif',
    name: 'Source Serif',
    desc: 'Long reading · geography, philosophy, history',
    stack: "'Source Serif 4', Georgia, 'Times New Roman', serif"
  },
  {
    id: 'lora',
    name: 'Lora',
    desc: 'Warm book serif · essays and literature',
    stack: "'Lora', Georgia, 'Times New Roman', serif"
  },
  {
    id: 'lexend',
    name: 'Lexend',
    desc: 'Easy-reading sans · designed to reduce reading strain',
    stack: "'Lexend', 'Google Sans', system-ui, sans-serif"
  },
  {
    id: 'jetbrains-mono',
    name: 'JetBrains Mono',
    desc: 'Monospace · code and technical notes',
    stack: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
  }
];

export const DEFAULT_READING_FONT = 'google-sans';

/** Resolve any stored value (new id or legacy CSS stack) to a valid id. */
export function normalizeReadingFont(value: unknown): string {
  if (typeof value === 'string') {
    const direct = READING_FONTS.find(font => font.id === value);
    if (direct) return direct.id;
    const legacy = value.toLowerCase();
    if (legacy.includes('jetbrains')) return 'jetbrains-mono';
    // Merriweather was offered but never loaded; Source Serif is its
    // academic-serif successor in the bundled set.
    if (legacy.includes('merriweather') || legacy.includes('serif')) return 'source-serif';
    if (legacy.includes('lora')) return 'lora';
    if (legacy.includes('lexend')) return 'lexend';
    if (legacy.includes('comic')) return 'lexend';
  }
  return DEFAULT_READING_FONT;
}

export function readingFontStack(id: string): string {
  return (READING_FONTS.find(font => font.id === id) || READING_FONTS[0]).stack;
}
