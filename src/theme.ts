// Color themes picked with the swatches next to the title. The choice is a per-browser preference,
// kept in localStorage; index.html applies it before the first paint and this module keeps it in sync.

export const PALETTES = {
  coral: { label: 'Warm coral', themeColor: '#af5a3f' },
  blue: { label: 'Ocean blue', themeColor: '#346aba' },
  lavender: { label: 'Soft lavender', themeColor: '#7752dc' },
  mint: { label: 'Fresh mint', themeColor: '#196e63' },
  graphite: { label: 'Graphite', themeColor: '#1f2124' },
} as const;

export type Palette = keyof typeof PALETTES;

const STORAGE_KEY = 'palette';
const isPalette = (value: unknown): value is Palette => typeof value === 'string' && value in PALETTES;

function savedPalette(): Palette {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'indigo') return 'blue'; // renamed; keep the visitor's choice
    return isPalette(value) ? value : 'coral';
  } catch {
    return 'coral';
  }
}

export function applyPalette(palette: Palette, picker: HTMLElement): void {
  // Coral is the default in the stylesheet, so it needs no attribute.
  if (palette === 'coral') delete document.documentElement.dataset.palette;
  else document.documentElement.dataset.palette = palette;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PALETTES[palette].themeColor);
  for (const btn of picker.querySelectorAll<HTMLButtonElement>('button[data-palette]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.palette === palette));
  }
  try {
    localStorage.setItem(STORAGE_KEY, palette);
  } catch {
    // Private mode or blocked storage: the theme still applies for this visit.
  }
}

export function initThemePicker(picker: HTMLElement): void {
  applyPalette(savedPalette(), picker);
  picker.addEventListener('click', (event) => {
    const value = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-palette]')?.dataset.palette;
    if (isPalette(value)) applyPalette(value, picker);
  });
}
