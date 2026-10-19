# large-csv-reader

Open, page through, search, slice and split **multi-gigabyte CSV files in the browser** (or in Node) without loading them into memory. Zero dependencies, about 250 lines.

```js
import { openLargeCsv } from 'large-csv-reader';

const csv = await openLargeCsv(file);          // a File from <input type="file"> or drag & drop
console.log(csv.rowCount, csv.header);          // 18402117 ['id', 'date', ...]
const rows = await csv.rows(5_000_000, 100);    // 100 parsed rows starting at row 5,000,000
const hits = await csv.search('C-88213');       // [{ row: 1234567, cells: [...] }, ...]
const sample = await csv.slice(1, 10_000);      // Blob: header + first 10,000 rows
for await (const part of csv.split()) { /* Blobs of 1,048,575 rows: each one opens in Excel */ }
```

**Live demo:** [csvcreator.com/en/large-csv-viewer](https://csvcreator.com/en/large-csv-viewer) is built on this library. Need a big file to try it? [Generate a sample CSV with up to 5 million rows](https://csvcreator.com/en/large-sample-csv-files) in your browser.

## Why

Excel stops at 1,048,576 rows, text editors freeze on files of a few hundred megabytes, and parsing a 2 GB CSV with a regular parser in the browser means holding the whole file, and every row object, in memory. Most of the time you only need to look at some rows, find a few, or cut the file into pieces.

## How it works

1. **One pass over raw bytes.** The file is read in 4 MB chunks with `Blob.slice()`. The scanner only looks at two byte values: `"` (0x22) toggles a quoted state and `\n` (0x0A) outside quotes ends a record. Both are single bytes in UTF-8 and Windows-1252, so nothing is decoded during indexing, and a line break inside a quoted field (an address, a comment) does not split the row.
2. **Sparse index.** Every 1,000th record's byte offset is stored. Ten million rows need an array of 10,000 numbers.
3. **Random access.** To read row *n*, the reader jumps to the nearest stored offset and scans at most one page of bytes, then decodes and parses only the rows requested.
4. **Byte-exact slices.** `slice()` and `split()` return `Blob`s built from `file.slice()` ranges plus the header bytes. Nothing is decoded or re-encoded, so a 1 GB part is created instantly and keeps the original quoting, delimiter and encoding.

## Performance

Measured on a 164 MB file with 3,000,000 rows (`bench/bench.js`):

| Operation | Chrome 129, desktop | Node 20, Xeon E5-1650 v3 |
|---|---|---|
| Index the whole file | 1–2 s (85–150 MB/s) | 2.5 s (66 MB/s) |
| Jump to row 2,400,000 and parse 100 rows | a few ms | 2 ms |
| Full-file search, no match | — | 1.5 s (110 MB/s) |
| Full-file search with matches (32 hits) | 5 s | — |

Memory use is bounded by one 4 MB chunk while indexing and one block (16 pages) while searching, regardless of file size.

## API

### `openLargeCsv(blob, options?) → Promise<LargeCsv>`

`blob` is any `Blob`/`File` (in Node, use `fs.openAsBlob(path)`, Node 20+).

| Option | Default | |
|---|---|---|
| `header` | `true` | First record is the header. Row numbers in the API are 1-based data rows. |
| `delimiter` | auto | `,` `;` tab or `|`, detected from the first 20 lines. |
| `encoding` | auto | `'utf-8'` or `'windows-1252'`, detected from the first megabyte. |
| `pageSize` | `1000` | Records between stored offsets. |
| `onProgress(fraction, records)` | | Called after every chunk while indexing. |
| `signal` | | `AbortSignal` to cancel indexing. |

The returned object has `rowCount`, `header`, `delimiter`, `encoding`, `index` and:

- `rows(start, count)` → `string[][]`
- `search(query, { limit = 1000, caseSensitive = false, signal, onProgress })` → `{ row, cells }[]`
- `slice(start, end)` → `Blob` with the header and rows `start..end` (inclusive)
- `split(rowsPerPart = 1048575)` → async generator of `Blob`s, each with the header

### Lower-level functions

`indexCsv`, `recordOffset`, `readRecordsText`, `forEachBlock`, `sliceCsv`, `parseCsv` (RFC 4180), `detectDelimiter`, `detectEncoding` and `EXCEL_MAX_ROWS` are exported for custom pipelines. See [`src/index.d.ts`](src/index.d.ts).

## Node example

```js
import { openAsBlob } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { openLargeCsv } from 'large-csv-reader';

const csv = await openLargeCsv(await openAsBlob('transactions.csv'));
let n = 0;
for await (const part of csv.split(1_000_000)) {
  await writeFile(`part-${++n}.csv`, Buffer.from(await part.arrayBuffer()));
}
```

## Limitations

- Quotes must be balanced, as RFC 4180 requires. A stray `"` inside an unquoted field (`27" monitor`) shifts record boundaries, exactly as it would for any compliant parser.
- Only `\n` and `\r\n` line endings are recognised. Files using a bare `\r` (classic Mac OS) are seen as one record.
- Encodings other than UTF-8 and Windows-1252 can be passed explicitly if `TextDecoder` supports them, but multi-byte encodings where `"` or `\n` can appear inside a character (UTF-16) are not supported.
- The index lives in memory; it is not persisted between sessions.

## Tests

```sh
npm test
```

## License

MIT. Made by [CSV Creator](https://csvcreator.com), free browser-based CSV tools: [CSV maker](https://csvcreator.com/en), [CSV to Excel](https://csvcreator.com/en/csv-to-excel), [merge CSV files](https://csvcreator.com/en/merge-csv-files), [remove duplicates](https://csvcreator.com/en/remove-duplicates-csv) and more.
