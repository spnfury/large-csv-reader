import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openLargeCsv, indexCsv, sliceCsv, parseCsv, detectEncoding, detectDelimiter } from '../src/index.js';

const N = 5003;
const build = (term = '\n', trailing = true, delim = ',') => {
    const lines = [['id', 'name', 'note'].join(delim)];
    for (let i = 1; i <= N; i++) {
        lines.push(i % 7 === 0 ? [i, '"Name ' + i + '"', '"multi\nline, ""q"""'].join(delim) : [i, `Ñame ${i}`, 'plain'].join(delim));
    }
    return new Blob([lines.join(term) + (trailing ? term : '')]);
};

for (const [term, trailing] of [['\n', true], ['\r\n', false]]) {
    test(`index and random access (${JSON.stringify(term)}, trailing=${trailing})`, async () => {
        const csv = await openLargeCsv(build(term, trailing));
        assert.equal(csv.rowCount, N);
        assert.deepEqual(csv.header, ['id', 'name', 'note']);
        for (const r of [1, 7, 999, 1000, 1001, 2345, N]) {
            const [row] = await csv.rows(r, 1);
            assert.equal(row[0], String(r));
        }
        const seven = (await csv.rows(7, 1))[0];
        assert.equal(seven[2], 'multi\nline, "q"');
    });
}

test('slice keeps header and exact rows', async () => {
    const csv = await openLargeCsv(build());
    const rows = parseCsv(await (await csv.slice(2000, 2009)).text());
    assert.equal(rows.length, 11);
    assert.equal(rows[0][0], 'id');
    assert.equal(rows[1][0], '2000');
    assert.equal(rows[10][0], '2009');
});

test('split covers every row once', async () => {
    const csv = await openLargeCsv(build());
    let total = 0;
    let parts = 0;
    for await (const part of csv.split(2000)) {
        const rows = parseCsv(await part.text());
        assert.equal(rows[0][0], 'id');
        total += rows.length - 1;
        parts++;
    }
    assert.equal(parts, 3);
    assert.equal(total, N);
});

test('search finds rows across blocks', async () => {
    const csv = await openLargeCsv(build());
    const hits = await csv.search('ñame 4999');
    assert.deepEqual(hits.map((h) => h.row), [4999]);
    const multi = await csv.search('LINE, "Q"', { limit: 5 });
    assert.equal(multi.length, 5);
    assert.equal(multi[0].row, 7);
});

test('semicolon files and no header', async () => {
    const csv = await openLargeCsv(build('\n', true, ';'), { header: false });
    assert.equal(csv.delimiter, ';');
    assert.equal(csv.rowCount, N + 1);
    assert.equal((await csv.rows(1, 1))[0][0], 'id');
});

test('page boundary and encodings', async () => {
    const blob = new Blob([['h', ...Array.from({ length: 999 }, (_, i) => String(i))].join('\n') + '\n']);
    const idx = await indexCsv(blob);
    assert.equal(idx.records, 1000);
    assert.equal(idx.offsets.length, 1);
    assert.equal(await detectEncoding(new Blob([Uint8Array.from([0x61, 0x2c, 0xe9, 0x0a, 0x62])])), 'windows-1252');
    assert.equal(await detectEncoding(new Blob(['a,é\n'])), 'utf-8');
    assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
    const s = await sliceCsv(blob, idx, 0, 3);
    assert.equal(await s.text(), 'h\n0\n1\n');
});
