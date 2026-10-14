// Fills a profile's food log with 60 days of made-up meals, for trying the food pie chart.
// Writes straight into testdata/<slug>-food.csv (timestamp,food,category); no JSON involved.
//
//   node scripts/generate-food-data.mts [profile-slug]     (default: juju)
//
// The current file is copied to testdata/.migrated/<slug>-food.before-test-data.csv first.
// Existing rows are kept; "beef brisket" is tagged Protein. Re-running doesn't duplicate rows.

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFoodCsv, toFoodCsv } from '../src/csv.ts';
import type { FoodCategoryId } from '../src/food.ts';
import type { FoodEntry } from '../src/types.ts';

const DAYS = 60;
const slug = process.argv[2] ?? 'juju';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'testdata');
const file = join(dir, `${slug}-food.csv`);

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

type Item = [text: string, category: FoodCategoryId];
const MEALS: Record<string, { hours: [number, number]; chance: number; items: Item[] }> = {
  breakfast: {
    hours: [7, 9],
    chance: 0.9,
    items: [
      ['Oatmeal with berries', 'grains'], ['Whole-wheat toast with jam', 'grains'], ['Granola', 'grains'],
      ['Greek yogurt with honey', 'dairy'], ['Cottage cheese', 'dairy'],
      ['Scrambled eggs', 'protein'], ['Veggie omelette', 'protein'], ['Banana and berries', 'produce'],
    ],
  },
  lunch: {
    hours: [12, 13],
    chance: 0.85,
    items: [
      ['Grilled chicken salad', 'protein'], ['Turkey sandwich', 'protein'], ['Tuna wrap', 'protein'], ['Tofu stir-fry', 'protein'],
      ['Garden salad', 'produce'], ['Vegetable soup', 'produce'],
      ['Rice bowl', 'grains'], ['Pasta salad', 'grains'],
    ],
  },
  dinner: {
    hours: [18, 20],
    chance: 0.95,
    items: [
      ['Salmon with rice', 'protein'], ['Beef stir-fry', 'protein'], ['Chicken curry', 'protein'], ['Pork chops', 'protein'],
      ['Roasted vegetables', 'produce'], ['Broccoli and carrots', 'produce'],
      ['Spaghetti', 'grains'], ['Fried rice', 'grains'], ['Mac and cheese', 'dairy'],
    ],
  },
  snack: {
    hours: [15, 16],
    chance: 0.5,
    items: [
      ['Dark chocolate', 'snacks'], ['Potato chips', 'snacks'], ['Cookies', 'snacks'], ['Granola bar', 'snacks'],
      ['Apple', 'produce'], ['Grapes', 'produce'], ['Cheese stick', 'dairy'],
    ],
  },
  drink: {
    hours: [10, 11],
    chance: 0.6,
    items: [['Latte', 'drinks'], ['Green tea', 'drinks'], ['Orange juice', 'drinks'], ['Sparkling water', 'drinks'], ['Fruit smoothie', 'drinks']],
  },
};

const generated: Omit<FoodEntry, 'id'>[] = [];
const now = new Date();
for (let ago = DAYS - 1; ago >= 0; ago--) {
  if (random() < 0.08) continue; // the odd day with nothing logged
  for (const meal of Object.values(MEALS)) {
    const roll = random();
    const [text, category] = pick(meal.items);
    const hour = meal.hours[0] + Math.floor(random() * (meal.hours[1] - meal.hours[0] + 1));
    const minute = Math.floor(random() * 60);
    const time = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago, hour, minute);
    if (roll < meal.chance && time.getTime() <= now.getTime()) generated.push({ timestamp: time.getTime(), text, category });
  }
}

let existingText = 'timestamp,food,category\n';
try {
  existingText = await readFile(file, 'utf8');
  await mkdir(join(dir, '.migrated'), { recursive: true });
  await copyFile(file, join(dir, '.migrated', `${slug}-food.before-test-data.csv`));
} catch {
  // No food file yet; start fresh.
}
const existing = parseFoodCsv(existingText).map((f) =>
  !f.category && f.text.trim().toLowerCase() === 'beef brisket' ? { ...f, category: 'protein' as const } : f,
);

const byKey = new Map<string, Omit<FoodEntry, 'id'>>();
for (const f of [...existing, ...generated]) byKey.set(`${f.timestamp}|${f.text}`, f);
const foods = [...byKey.values()].map((f, i) => ({ id: String(i), ...f }));

await writeFile(file, toFoodCsv({ version: 1, userId: slug, name: slug, unit: 'kg', entries: [], foods }));
console.log(`Wrote ${foods.length} food entries (${existing.length} kept, ${foods.length - existing.length} added) to ${file}`);
