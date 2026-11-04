import pc from 'picocolors';
import { startSpinner } from './ui/spinner';
import { brand, hyperlink, toned, type Tone } from './ui/style';

export interface Output {
  json: boolean;
  data(value: unknown): void;
  print(text: string): void;
  table<T>(rows: T[], columns: Column<T>[], empty: EmptyState): void;
  banner(version: string): void;
  step(message: string): void;
  note(message: string): void;
  success(message: string): void;
  info(message: string): void;
  link(text: string, url: string): string;
  task<T>(label: string, run: () => Promise<T>): Promise<T>;
}

export interface EmptyState {
  message: string;
  hint?: string;
}

export interface Column<T> {
  header: string;
  value: (row: T) => string;
  tone?: (row: T) => Tone;
}

export interface Streams {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
}

const COLUMN_GAP = '  ';
const SECOND_MS = 1000;
const NOTE_INDENT = '  ';

export function renderTable<T>(rows: T[], columns: Column<T>[]) {
  const cells = rows.map((row) => columns.map((column) => column.value(row)));
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...cells.map((line) => line[index]?.length ?? 0)),
  );
  const line = (values: string[], paint: (value: string, index: number) => string) =>
    values
      .map((value, index) => paint(index === values.length - 1 ? value : value.padEnd(widths[index] ?? 0), index))
      .join(COLUMN_GAP)
      .trimEnd();

  const header = pc.dim(line(columns.map((column) => column.header), (value) => value));
  const body = rows.map((row, rowIndex) =>
    line(cells[rowIndex] ?? [], (value, index) => toned(value, columns[index]?.tone?.(row) ?? 'plain')),
  );

  return [header, ...body].join('\n');
}

export function formatDuration(ms: number) {
  return ms < SECOND_MS ? `${Math.round(ms)}ms` : `${(ms / SECOND_MS).toFixed(1)}s`;
}

export function createOutput(
  json: boolean,
  streams: Streams = process,
  { decorated = false, hyperlinks = false }: { decorated?: boolean; hyperlinks?: boolean } = {},
): Output {
  let lastDuration: number | undefined;
  const speak = (text: string) => {
    if (!json) streams.stderr.write(`${text}\n`);
  };

  return {
    json,
    data(value) {
      streams.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    },
    print(text) {
      streams.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
    },
    table(rows, columns, empty) {
      if (json) return this.data(rows);
      if (rows.length === 0) {
        this.info(empty.message);
        if (empty.hint) this.note(empty.hint);
        return;
      }
      streams.stdout.write(`${renderTable(rows, columns)}\n`);
    },
    banner(version) {
      if (decorated) speak(`${brand('Nulvless CLI')} ${pc.dim(version)}`);
    },
    step(message) {
      speak(`${brand('>')} ${message}`);
    },
    note(message) {
      speak(
        message
          .split('\n')
          .map((line) => `${NOTE_INDENT}${pc.dim(line)}`)
          .join('\n'),
      );
    },
    success(message) {
      const timing = lastDuration === undefined ? '' : ` ${pc.dim(`[${formatDuration(lastDuration)}]`)}`;
      lastDuration = undefined;
      speak(`${pc.green('✓')} ${message}${timing}`);
    },
    info(message) {
      speak(message);
    },
    link(text, url) {
      return decorated && hyperlinks ? pc.underline(hyperlink(text, url)) : `${text}: ${url}`;
    },
    async task(label, run) {
      const startedAt = performance.now();
      const spinner = json || !decorated ? null : startSpinner(streams.stderr, label, (frame) => brand(frame));

      try {
        return await run();
      } finally {
        spinner?.stop();
        lastDuration = performance.now() - startedAt;
      }
    },
  };
}
