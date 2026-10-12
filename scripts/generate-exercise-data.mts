// Fills a profile's exercise log with 60 days of made-up sessions, for trying the Exercise charts.
// Writes straight into userdata/<slug>-exercise.csv (timestamp,activity,category,minutes); no JSON involved.
//
//   node scripts/generate-exercise-data.mts [profile-slug]     (default: juju)
//
// If the file already exists it is copied to userdata/.migrated/<slug>-exercise.before-test-data.csv
// first, and its rows are kept. Re-running doesn't duplicate rows.

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExerciseCsv, toExerciseCsv } from '../src/csv.ts';
import type { ExerciseCategoryId } from '../src/exercise.ts';
import type { ExerciseEntry } from '../src/types.ts';

const DAYS = 60;
const slug = process.argv[2] ?? 'juju';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'userdata');
const file = join(dir, `${slug}-exercise.csv`);

// mulberry32: small seeded PRNG returning [0, 1).
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(20261012);
const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
const between = (lo: number, hi: number, step = 5) => lo + Math.round((random() * (hi - lo)) / step) * step;

type Kind = { names: string[]; minutes: [number, number]; hours: [number, number] };
const KINDS: Record<ExerciseCategoryId, Kind> = {
  cardio: { names: ['Morning run', 'Bike ride', 'Swim', 'Brisk walk', 'Rowing machine', 'Elliptical'], minutes: [20, 60], hours: [6, 8] },
  strength: { names: ['Weights, upper body', 'Weights, legs', 'Full-body circuit', 'Kettlebell workout', 'Core and planks'], minutes: [30, 50], hours: [17, 19] },
  flexibility: { names: ['Yoga', 'Stretching', 'Pilates', 'Mobility routine'], minutes: [10, 30], hours: [20, 21] },
};

let existing: Omit<ExerciseEntry, 'id'>[] = [];
try {
  const text = await readFile(file, 'utf8');
  await mkdir(join(dir, '.migrated'), { recursive: true });
  await copyFile(file, join(dir, '.migrated', `${slug}-exercise.before-test-data.csv`));
  existing = parseExerciseCsv(text);
} catch {
  // No file yet.
}

const generated: Omit<ExerciseEntry, 'id'>[] = [];
const today = new Date();
today.setHours(0, 0, 0, 0);
for (let back = DAYS - 1; back >= 0; back--) {
  const day = new Date(today);
  day.setDate(day.getDate() - back);
  // Weekly rhythm: cardio most weekdays, strength three times a week, flexibility on some evenings; rest days happen.
  const weekday = day.getDay();
  if (random() < 0.12) continue;
  const plan: ExerciseCategoryId[] = [];
  if ([1, 3, 5, 6].includes(weekday) ? random() < 0.85 : random() < 0.3) plan.push('cardio');
  if ([2, 4, 6].includes(weekday) && random() < 0.8) plan.push('strength');
  if (random() < 0.35) plan.push('flexibility');
  for (const category of plan) {
    const k = KINDS[category];
    const when = new Date(day);
    when.setHours(between(k.hours[0], k.hours[1], 1), Math.floor(random() * 60), 0, 0);
    if (when.getTime() > Date.now()) continue;
    generated.push({ timestamp: when.getTime(), name: pick(k.names), category, minutes: between(k.minutes[0], k.minutes[1]) });
  }
}

const seen = new Set(existing.map((e) => `${e.timestamp}|${e.name}`));
const exercises = [...existing, ...generated.filter((e) => !seen.has(`${e.timestamp}|${e.name}`))].map((e, i) => ({ id: String(i), ...e }));
await mkdir(dir, { recursive: true });
await writeFile(file, toExerciseCsv({ version: 1, userId: slug, name: slug, unit: 'kg', entries: [], exercises }));
console.log(`Wrote ${exercises.length} sessions to ${file}`);
