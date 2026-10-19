export interface CsvIndex {
    /** offsets[p] is the byte offset where record p * pageSize starts. */
    offsets: number[];
    /** Total records, header included. */
    records: number;
    pageSize: number;
}

export interface ProgressOptions {
    onProgress?: (fraction: number, records?: number) => void;
    signal?: AbortSignal;
}

export type Encoding = 'utf-8' | 'windows-1252';

export interface LargeCsv {
    index: CsvIndex;
    encoding: Encoding;
    delimiter: string;
    header: string[];
    /** Data rows, header excluded. */
    rowCount: number;
    /** `count` parsed rows starting at 1-based data row `start`. */
    rows(start: number, count: number): Promise<string[][]>;
    /** Rows where any cell contains `query`. */
    search(query: string, options?: { limit?: number; caseSensitive?: boolean } & ProgressOptions): Promise<{ row: number; cells: string[] }[]>;
    /** Header plus data rows [start, end] (1-based, inclusive), copied byte for byte. */
    slice(start: number, end: number): Promise<Blob>;
    /** Parts of `rowsPerPart` data rows, each with the header. Defaults to Excel's limit. */
    split(rowsPerPart?: number): AsyncGenerator<Blob>;
}

export function openLargeCsv(blob: Blob, options?: { header?: boolean; delimiter?: string; encoding?: Encoding; pageSize?: number } & ProgressOptions): Promise<LargeCsv>;
export function indexCsv(blob: Blob, options?: { pageSize?: number; chunkSize?: number } & ProgressOptions): Promise<CsvIndex>;
export function recordOffset(blob: Blob, index: CsvIndex, record: number): Promise<number>;
export function detectEncoding(blob: Blob): Promise<Encoding>;
export function detectDelimiter(text: string): string;
export function parseCsv(text: string, delimiter?: string): string[][];
export function readRecordsText(blob: Blob, index: CsvIndex, from: number, to: number, encoding?: Encoding): Promise<string>;
export function forEachBlock(blob: Blob, index: CsvIndex, visit: (text: string, firstRecord: number) => boolean | void, options?: { encoding?: Encoding; pagesPerBlock?: number } & ProgressOptions): Promise<void>;
export function sliceCsv(blob: Blob, index: CsvIndex, from: number, to: number, options?: { header?: boolean; type?: string }): Promise<Blob>;
export const EXCEL_MAX_ROWS: 1048576;
