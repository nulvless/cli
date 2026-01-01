import { CliError } from './errors';

type FetchText = (url: string) => Promise<Response>;

export async function readDocs(docsUrl: string, path: string | undefined, fetchImpl: FetchText = fetch) {
  const page = path?.split('/').filter(Boolean).join('/');
  const url = page ? `${docsUrl}/llms.mdx/docs/${page}/content.md` : `${docsUrl}/llms.txt`;

  const response = await fetchImpl(url).catch(() => {
    throw new CliError(`Could not reach the Nulvless docs at ${new URL(docsUrl).host}.`, {
      hint: 'Check your connection and try again.',
    });
  });

  if (response.status === 404) {
    throw new CliError(`There is no docs page at ${page}.`, { hint: 'Run `nulvless docs` to list every page.' });
  }
  if (!response.ok) throw new CliError(`The Nulvless docs answered with status ${response.status}.`);

  return response.text();
}
