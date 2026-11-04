import { Option } from 'commander';

export const PRODUCTION_ENVIRONMENT = 'main';

export function environmentOption() {
  return new Option('--env <environment>', 'environment slug').default(PRODUCTION_ENVIRONMENT);
}

export function environmentLabel(environment: string) {
  return environment === PRODUCTION_ENVIRONMENT ? 'production (main)' : environment;
}
