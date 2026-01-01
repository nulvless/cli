import { readDocs } from '../docs';

function fetchAnswering(status: number, body = '') {
  return jest.fn(async (_url: string) => new Response(body, { status }));
}

describe('readDocs', () => {
  it('reads the index of every page when no path is given', async () => {
    const fetchImpl = fetchAnswering(200, '# Nulvless');

    await expect(readDocs('https://www.nulvless.com', undefined, fetchImpl)).resolves.toBe('# Nulvless');
    expect(fetchImpl).toHaveBeenCalledWith('https://www.nulvless.com/llms.txt');
  });

  it('reads one page as Markdown', async () => {
    const fetchImpl = fetchAnswering(200, '# Auth');

    await readDocs('https://www.nulvless.com', '/sdk/auth/', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith('https://www.nulvless.com/llms.mdx/docs/sdk/auth/content.md');
  });

  it('points to the index when the page does not exist', async () => {
    await expect(readDocs('https://www.nulvless.com', 'nope', fetchAnswering(404))).rejects.toMatchObject({
      message: 'There is no docs page at nope.',
      hint: 'Run `nulvless docs` to list every page.',
    });
  });

  it('explains when the docs cannot be reached', async () => {
    const failing = jest.fn(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(readDocs('https://www.nulvless.com', undefined, failing)).rejects.toMatchObject({
      message: 'Could not reach the Nulvless docs at www.nulvless.com.',
    });
  });
});
