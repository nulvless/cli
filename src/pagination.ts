import { InvalidArgumentError, type Command } from 'commander';
import { CliError } from './errors';
import type { Output } from './output';

export const MAX_PAGE_SIZE = 100;
const DEFAULT_LIMIT = 30;

export interface Page<T> {
  items: T[];
  total?: number;
}

export interface PageRequest {
  page: number;
  limit: number;
  sort: 'asc' | 'desc';
  all: boolean;
}

export interface PageFlags {
  page: number;
  limit: number;
  all?: boolean;
  oldestFirst?: boolean;
}

export const EVERY_PAGE: PageRequest = { page: 1, limit: MAX_PAGE_SIZE, sort: 'desc', all: true };

function wholeNumber(value: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new InvalidArgumentError('Use a whole number, 1 or more.');
  return number;
}

export function withPageOptions(command: Command) {
  return command
    .option('--limit <count>', 'how many to show per page', wholeNumber, DEFAULT_LIMIT)
    .option('--page <number>', 'which page to show', wholeNumber, 1)
    .option('--all', 'show every page')
    .option('--oldest-first', 'start from the oldest');
}

export function pageRequest(flags: PageFlags, command: Command): PageRequest {
  if (flags.all && command.getOptionValueSource('page') === 'cli') throw new CliError('Choose either --all or --page.');
  return { page: flags.page, limit: flags.limit, sort: flags.oldestFirst ? 'asc' : 'desc', all: Boolean(flags.all) };
}

export function notePage(output: Output, page: Page<unknown>, request: PageRequest) {
  if (output.json || request.all || page.total === undefined) return;
  const first = (request.page - 1) * request.limit + 1;
  const last = first + page.items.length - 1;
  if (last >= page.total) return;
  output.note(`Showing ${first}–${last} of ${page.total}. Next page: --page ${request.page + 1}, or --all for every one.`);
}
