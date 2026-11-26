// Writes test/data/juju-60d.csv: 60 days of made-up weigh-ins ending today, for trying the app.
// Same format the app writes: "date,weight_kg", one row per date, rounded to 0.1.
// The random numbers come from a fixed seed, so the pattern is the same each run; only the dates move.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DAYS = 60;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'data', 'juju-60d.csv');

// mulberry32: small seeded PRNG returning [0, 1).
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(20261011);

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const rows = ['date,weight_kg'];
const row = (date, kg) => `${localDate(date)},${kg}`;
const today = new Date();
let daysLogged = 0;

for (let ago = DAYS - 1; ago >= 0; ago--) {
  const progress = (DAYS - 1 - ago) / (DAYS - 1);
  const isGap = ago >= 30 && ago <= 33; // one 4-day break, about a month ago
  const missed = random() < 0.15; // plus the odd single missed day
  const noise = (random() - 0.5) * 1.0; // ±0.5 kg
  if (isGap || (missed && ago !== 0)) continue;

  const base = 72 - 2.5 * progress + noise;
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ago);
  rows.push(row(day, Number(base.toFixed(1))));
  daysLogged++;
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, rows.join('\n') + '\n');
console.log(`Wrote ${rows.length - 1} entries over ${daysLogged} of ${DAYS} days to ${OUT}`);
