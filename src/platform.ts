export interface Platform {
  issuer: string;
  publishableKey: string;
  apiUrl: string;
  clientId: string;
  docsUrl: string;
  consoleUrl: string;
  examplesUrl: string;
}

export const consoleUrl = 'https://cloud.nulvless.com';

export const NULVLESS_CLI_CLIENT_ID = 'ivjzj27zleas22zxhsado518';

export function platformFrom(env: NodeJS.ProcessEnv): Platform {
  return {
    issuer: env.NULVLESS_ISSUER ?? 'https://io.nulvless.com',
    publishableKey: env.NULVLESS_PUBLISHABLE_KEY ?? 'pk-S4zI2-mxMKZwu57iQJY2le6oeYfIoHCZ',
    apiUrl: env.NULVLESS_API_URL ?? 'https://api.nulvless.com',
    clientId: env.NULVLESS_CLIENT_ID ?? NULVLESS_CLI_CLIENT_ID,
    docsUrl: env.NULVLESS_DOCS_URL ?? 'https://www.nulvless.com',
    consoleUrl: env.NULVLESS_CONSOLE_URL ?? consoleUrl,
    examplesUrl: env.NULVLESS_EXAMPLES_URL ?? 'https://raw.githubusercontent.com/nulvless/examples/main',
  };
}

export function callbackUrl(port: number) {
  return `http://127.0.0.1:${port}/callback`;
}
