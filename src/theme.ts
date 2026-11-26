// Color themes, picked on the Settings page and saved with the profile (ProfileSettings.palette).
// The last one applied is also kept in this browser's localStorage, so index.html can paint the login
// page in it before the first frame.

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

/** Applies a color theme to the page, marks its swatch in `picker`, and remembers it in this browser. */
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

/** Calls `onPick` with the palette whose swatch in `picker` is clicked. */
export function initThemePicker(picker: HTMLElement, onPick: (palette: Palette) => void): void {
  picker.addEventListener('click', (event) => {
    const value = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-palette]')?.dataset.palette;
    if (isPalette(value)) onPick(value);
  });
}
