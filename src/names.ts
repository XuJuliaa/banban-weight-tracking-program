/**
 * A profile's key and file-name stem, from its name: "Juju" → "juju", "Ana María" → "ana-mar-a".
 * Profiles are identified by this, so "Juju" and "juju" are the same profile.
 */
export function profileSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'user';
}
