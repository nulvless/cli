import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignInError } from '../errors';
import { callbackUrl } from '../platform';

export interface Callback {
  redirectUri: string;
  code: Promise<string>;
  redirectBrowserTo(url: string): void;
  showFailure(message: string): void;
  close(): void;
}

const CALLBACK_PATH = '/callback';

const HTML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (character) => HTML_ENTITIES[character] ?? character);
}

function page(title: string, message: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0f0e14;color:#f2f1f6;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:28rem;padding:2rem;text-align:center}p{color:#a5a3ad}</style>
</head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

function reply(response: ServerResponse, status: number, title: string, message: string) {
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
  response.end(page(escapeHtml(title), escapeHtml(message)));
}

function listenOnFreePort(server: Server) {
  return new Promise<number>((resolve, reject) => {
    server.once('error', () => reject(new SignInError('Could not open a local port for the sign-in.')));
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

export async function listenForCallback(state: string, timeoutMs: number): Promise<Callback> {
  let waitingBrowser: ServerResponse | undefined;
  let settle: { resolve: (code: string) => void; reject: (error: Error) => void } | undefined;
  const code = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end();
      return;
    }

    const error = url.searchParams.get('error');
    if (error) {
      reply(response, 400, 'Sign-in was not completed', 'Return to the terminal for details.');
      settle?.reject(new SignInError(url.searchParams.get('error_description') ?? `Authorization failed: ${error}.`));
      return;
    }

    if (url.searchParams.get('state') !== state) {
      reply(response, 400, 'Sign-in was not completed', 'This response does not belong to the current sign-in.');
      settle?.reject(new SignInError('The authorization response did not match this sign-in.'));
      return;
    }

    const received = url.searchParams.get('code');
    if (!received) {
      reply(response, 400, 'Sign-in was not completed', 'The authorization server sent no code.');
      settle?.reject(new SignInError('The authorization server sent no code.'));
      return;
    }

    waitingBrowser = response;
    settle?.resolve(received);
  });

  const port = await listenOnFreePort(server);

  const timer = setTimeout(
    () => settle?.reject(new SignInError('Sign-in timed out.')),
    timeoutMs,
  );
  const answerBrowser = (answer: (response: ServerResponse) => void) => {
    if (!waitingBrowser) return;
    answer(waitingBrowser);
    waitingBrowser = undefined;
  };

  const close = () => {
    answerBrowser((response) => reply(response, 200, 'Return to the terminal', 'You can close this tab.'));
    clearTimeout(timer);
    server.closeAllConnections();
    server.close();
  };

  return {
    redirectUri: callbackUrl(port),
    code,
    redirectBrowserTo: (url) =>
      answerBrowser((response) => response.writeHead(302, { Location: url, Connection: 'close' }).end()),
    showFailure: (message) =>
      answerBrowser((response) => reply(response, 400, 'Sign-in was not completed', message)),
    close,
  };
}
