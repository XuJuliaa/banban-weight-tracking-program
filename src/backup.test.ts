import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { zipFiles } from './backup';

const WEIGHT = 'timestamp,weight_kg,weight_lb,entered_unit\n2026-10-01T08:00:00,70,154.32,kg\n';
const FOOD = 'timestamp,food,category\n2026-10-01T12:00:00,"rice, beans",Grains & starches\n';

describe('zipFiles', () => {
  it('zips the files with their names and text', () => {
    const files = { 'weight-Juju.csv': WEIGHT, 'food-Juju.csv': FOOD };
    const unzipped = unzipSync(zipFiles(files));
    expect(Object.fromEntries(Object.entries(unzipped).map(([name, data]) => [name, strFromU8(data)]))).toEqual(files);
  });
});
