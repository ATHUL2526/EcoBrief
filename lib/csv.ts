// CSV reading and writing for the data files: minimal quoting and CRLF line endings, which every
// spreadsheet app opens.

const FIELD_END = /[,\r\n]/g;

/** Rows of fields. Handles quoted fields, doubled quotes and line breaks inside quotes; skips blank lines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = text.startsWith("﻿") ? 1 : 0;
  while (i < text.length) {
    if (row.length === 0 && (text[i] === "\n" || text[i] === "\r")) {
      i++; // blank line
      continue;
    }
    let field = "";
    if (text[i] === '"') {
      // Quoted part ("" is a literal quote); anything after the closing quote is kept as typed.
      for (i++; ;) {
        const close = text.indexOf('"', i);
        if (close < 0) {
          field += text.slice(i);
          i = text.length;
          break;
        }
        field += text.slice(i, close);
        i = close + 1;
        if (text[i] !== '"') break;
        field += '"';
        i++;
      }
    }
    FIELD_END.lastIndex = i;
    const end = FIELD_END.exec(text)?.index ?? text.length;
    row.push(field + text.slice(i, end));
    i = end;
    if (text[i] === ",") {
      i++;
      if (i === text.length) row.push(""); // trailing empty field at the very end
      continue;
    }
    // End of the record: \r\n, \n, \r or the end of the text.
    i += text.startsWith("\r\n", i) ? 2 : 1;
    rows.push(row);
    row = [];
  }
  if (row.length) rows.push(row);
  return rows;
}

/** Rows as objects keyed by the header row; missing cells become "". */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const [header = [], ...rows] = parseCsv(text);
  return rows.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ""])));
}

function formatField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** CSV text with a header row of `columns`; values missing from a row are written as "". */
export function formatCsv(columns: readonly string[], rows: readonly Record<string, string>[]): string {
  const lines = [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ""))];
  return lines.map((cells) => cells.map(formatField).join(",")).join("\r\n") + "\r\n";
}
