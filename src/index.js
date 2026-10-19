// large-csv-reader: open multi-gigabyte CSV files in the browser (or Node) without
// loading them into memory.
//
// The file is scanned once as raw bytes. '"' (0x22) and '\n' (0x0A) are single bytes in
// UTF-8 and in Windows-1252, so record boundaries can be found without decoding, and a
// newline inside a quoted field does not end the record. The index keeps the byte offset
// where every `pageSize`-th record starts, so any row is reached by reading at most one
// page of bytes, and slices are copied byte for byte.

const QUOTE = 0x22;
const LF = 0x0a;
const DELIMITERS = [',', ';', '\t', '|'];

const tick = () => new Promise((r) => setTimeout(r, 0));
const abortError = () => new DOMException('Aborted', 'AbortError');
const readBytes = async (blob, start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer());

/**
 * Scans the blob and returns { offsets, records, pageSize }.
 * offsets[p] is the byte offset of record p * pageSize; records counts every record,
 * header included.
 */
export async function indexCsv(blob, { pageSize = 1000, chunkSize = 4 * 1024 * 1024, onProgress, signal } = {}) {
    const offsets = [0];
    let records = 0;
    let inQuotes = false;
    let lastByte = -1;
    for (let start = 0; start < blob.size; start += chunkSize) {
        if (signal?.aborted) throw abortError();
        const bytes = await readBytes(blob, start, Math.min(start + chunkSize, blob.size));
        for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i];
            if (b === QUOTE) inQuotes = !inQuotes;
            else if (b === LF && !inQuotes) {
                records++;
                if (records % pageSize === 0) offsets.push(start + i + 1);
            }
        }
        lastByte = bytes[bytes.length - 1];
        onProgress?.(Math.min(start + chunkSize, blob.size) / blob.size, records);
        await tick();
    }
    // A last record without a trailing newline still counts.
    if (blob.size > 0 && lastByte !== LF) records++;
    // An offset pointing at EOF (file ends exactly on a page boundary) is not a record.
    if (offsets.length > 1 && offsets[offsets.length - 1] >= blob.size) offsets.pop();
    return { offsets, records, pageSize };
}

const pageEnd = (index, page, size) => (page + 1 < index.offsets.length ? index.offsets[page + 1] : size);

/** Byte offset where record `r` starts (`index.records` gives the blob size). */
export async function recordOffset(blob, index, r) {
    if (r >= index.records) return blob.size;
    const page = Math.floor(r / index.pageSize);
    let skip = r % index.pageSize;
    const base = index.offsets[page];
    if (skip === 0) return base;
    const bytes = await readBytes(blob, base, pageEnd(index, page, blob.size));
    let inQuotes = false;
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b === QUOTE) inQuotes = !inQuotes;
        else if (b === LF && !inQuotes && --skip === 0) return base + i + 1;
    }
    return blob.size;
}

/** 'utf-8' or 'windows-1252', decided from the first megabyte. */
export async function detectEncoding(blob) {
    const bytes = await readBytes(blob, 0, Math.min(blob.size, 1024 * 1024));
    let end = bytes.length;
    if (blob.size > bytes.length) {
        // Drop a multi-byte character cut by the sample boundary.
        while (end > 0 && end > bytes.length - 4 && (bytes[end - 1] & 0xc0) === 0x80) end--;
        if (end > 0 && bytes[end - 1] >= 0xc0) end--;
    }
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end));
        return 'utf-8';
    } catch {
        return 'windows-1252';
    }
}

/** Picks the delimiter that gives the most consistent column count over the first lines. */
export function detectDelimiter(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 20);
    let best = ',';
    let bestScore = -1;
    for (const d of DELIMITERS) {
        const counts = lines.map((l) => l.split(d).length);
        if (!counts.length || counts[0] < 2) continue;
        const score = counts.filter((c) => c === counts[0]).length * 1000 + counts[0];
        if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
}

/** RFC 4180 parser: quoted fields, doubled quotes, line breaks inside quotes, CRLF. */
export function parseCsv(text, delimiter = ',') {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (inQuotes) {
            if (ch === '"') {
                if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
            } else field += ch;
            continue;
        }
        if (ch === '"') inQuotes = true;
        else if (ch === delimiter) { row.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && src[i + 1] === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else field += ch;
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
    while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
    return rows;
}

/** Decoded text of records [from, to). */
export async function readRecordsText(blob, index, from, to, encoding = 'utf-8') {
    const start = await recordOffset(blob, index, from);
    const end = await recordOffset(blob, index, Math.min(to, index.records));
    return new TextDecoder(encoding).decode(await readBytes(blob, start, end));
}

/**
 * Calls visit(text, firstRecord) for consecutive blocks of whole pages; return false
 * from visit to stop early. Memory use is bounded by one block.
 */
export async function forEachBlock(blob, index, visit, { encoding = 'utf-8', pagesPerBlock = 16, signal, onProgress } = {}) {
    const decoder = new TextDecoder(encoding);
    const pages = index.offsets.length;
    for (let p = 0; p < pages; p += pagesPerBlock) {
        if (signal?.aborted) throw abortError();
        const last = Math.min(p + pagesPerBlock, pages);
        const end = pageEnd(index, last - 1, blob.size);
        const text = decoder.decode(await readBytes(blob, index.offsets[p], end));
        if (visit(text, p * index.pageSize) === false) return;
        onProgress?.(end / blob.size);
        await tick();
    }
}

/**
 * Blob with the header record (unless from is 0 or header is false) followed by
 * records [from, to), copied byte for byte: no decoding, so it is fast for any size.
 */
export async function sliceCsv(blob, index, from, to, { header = true, type = 'text/csv' } = {}) {
    const parts = [];
    if (header && from > 0) parts.push(blob.slice(0, await recordOffset(blob, index, 1)));
    const start = await recordOffset(blob, index, from);
    const end = await recordOffset(blob, index, Math.min(to, index.records));
    parts.push(blob.slice(start, end));
    return new Blob(parts, { type });
}

/** Rows Excel can hold in one sheet, header included. */
export const EXCEL_MAX_ROWS = 1048576;

/**
 * High-level API.
 *
 *   const csv = await openLargeCsv(file);
 *   csv.rowCount;                  // data rows (header excluded)
 *   csv.header;                    // ['id', 'name', ...]
 *   await csv.rows(1_000_000, 50); // 50 parsed rows starting at data row 1,000,000
 *
 * Row numbers are 1-based data rows: row 1 is the first line after the header.
 */
export async function openLargeCsv(blob, { header = true, delimiter, encoding, pageSize = 1000, onProgress, signal } = {}) {
    const enc = encoding || await detectEncoding(blob);
    const index = await indexCsv(blob, { pageSize, onProgress, signal });
    const headText = await readRecordsText(blob, index, 0, Math.min(index.records, 20), enc);
    const delim = delimiter || detectDelimiter(headText);
    const first = header ? 1 : 0;
    const cols = parseCsv(headText, delim)[0] || [];
    return {
        index,
        encoding: enc,
        delimiter: delim,
        header: header ? cols : cols.map((_, i) => `column_${i + 1}`),
        rowCount: Math.max(index.records - first, 0),

        /** `count` parsed rows starting at data row `start` (1-based). */
        async rows(start, count) {
            const from = first + Math.max(1, start) - 1;
            return parseCsv(await readRecordsText(blob, index, from, from + count, enc), delim);
        },

        /**
         * Rows where any cell contains `query` (case-insensitive by default).
         * Returns [{ row, cells }] with 1-based data row numbers, up to `limit`.
         */
        async search(query, { limit = 1000, caseSensitive = false, signal: s, onProgress: p } = {}) {
            const needle = caseSensitive ? query : query.toLowerCase();
            const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? '' : 'i');
            const hasQuote = query.includes('"');
            const found = [];
            await forEachBlock(blob, index, (text, firstRecord) => {
                // Most blocks have no match: skip parsing them. Quotes are doubled
                // inside quoted fields, so a query with quotes can't use the shortcut.
                if (!hasQuote && !re.test(text)) return true;
                const parsed = parseCsv(text, delim);
                for (let i = 0; i < parsed.length; i++) {
                    const rec = firstRecord + i;
                    if (rec < first) continue;
                    if (parsed[i].some((c) => (caseSensitive ? c : c.toLowerCase()).includes(needle))) {
                        found.push({ row: rec - first + 1, cells: parsed[i] });
                        if (found.length >= limit) return false;
                    }
                }
                return true;
            }, { encoding: enc, signal: s, onProgress: p });
            return found;
        },

        /** Blob with the header plus data rows [start, end] (1-based, inclusive). */
        slice(start, end) {
            return sliceCsv(blob, index, first + start - 1, first + end, { header });
        },

        /** Yields Blobs of `rowsPerPart` data rows, each starting with the header. */
        async *split(rowsPerPart = EXCEL_MAX_ROWS - 1) {
            const total = Math.max(index.records - first, 0);
            for (let s = 1; s <= total; s += rowsPerPart) {
                yield sliceCsv(blob, index, first + s - 1, first + Math.min(s + rowsPerPart - 1, total), { header });
            }
        },
    };
}
