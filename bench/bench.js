// Usage: node bench/bench.js path/to/file.csv
import { openAsBlob } from 'node:fs';
import { openLargeCsv } from '../src/index.js';

const blob = await openAsBlob(process.argv[2]);
const mb = blob.size / 1048576;
let t0 = performance.now();
const csv = await openLargeCsv(blob);
const index = (performance.now() - t0) / 1000;
t0 = performance.now();
await csv.rows(Math.floor(csv.rowCount * 0.8), 100);
const jump = performance.now() - t0;
t0 = performance.now();
const hits = await csv.search('zzz-not-there');
const search = (performance.now() - t0) / 1000;
console.log(`${mb.toFixed(0)} MB, ${csv.rowCount.toLocaleString('en')} rows`);
console.log(`index:  ${index.toFixed(2)} s (${(mb / index).toFixed(0)} MB/s)`);
console.log(`jump to row ${Math.floor(csv.rowCount * 0.8).toLocaleString('en')} and read 100 rows: ${jump.toFixed(1)} ms`);
console.log(`full scan search: ${search.toFixed(2)} s (${(mb / search).toFixed(0)} MB/s), ${hits.length} hits`);
