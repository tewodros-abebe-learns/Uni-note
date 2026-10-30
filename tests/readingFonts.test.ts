import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { READING_FONTS, DEFAULT_READING_FONT, normalizeReadingFont, readingFontStack } from '../src/lib/readingFonts';

test('google-sans is the default and every choice resolves to a stack', () => {
  assert.equal(DEFAULT_READING_FONT, 'google-sans');
  for (const font of READING_FONTS) assert.ok(readingFontStack(font.id).length > 0, font.id);
  assert.match(readingFontStack('google-sans'), /Google Sans/);
});

test('legacy stored stacks migrate to bundled successors', () => {
  assert.equal(normalizeReadingFont('var(--font-gemini)'), 'google-sans');
  assert.equal(normalizeReadingFont("'Merriweather', serif"), 'source-serif');
  assert.equal(normalizeReadingFont("'JetBrains Mono', monospace"), 'jetbrains-mono');
  assert.equal(normalizeReadingFont("'Comic Sans MS', 'Comic Sans', cursive"), 'lexend');
  assert.equal(normalizeReadingFont('lora'), 'lora');
  assert.equal(normalizeReadingFont('nonsense'), 'google-sans');
  assert.equal(normalizeReadingFont(undefined), 'google-sans');
  assert.equal(normalizeReadingFont(42), 'google-sans');
});

test('every offered family is actually bundled via @font-face', () => {
  const css = readFileSync('src/index.css', 'utf8');
  for (const family of ['Google Sans', 'Source Serif 4', 'Lora', 'Lexend', 'JetBrains Mono'])
    assert.ok(css.includes(`font-family: '${family}'`), family);
  // No offered option may name a font we never load (the old Merriweather bug).
  assert.ok(!READING_FONTS.some(f => /merriweather|comic/i.test(f.stack + f.name)));
});
