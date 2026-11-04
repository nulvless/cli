import type { Api } from './http';

export interface Organization {
  slug: string;
  name: string;
}

export interface Environment {
  slug: string;
  name: string;
  status: string;
  url: string;
  version: string | null;
}

export interface Project {
  slug: string;
  name: string;
  environments: Environment[];
}

export interface EdgeFunction {
  slug: string;
  name: string;
  status: string;
  version: string;
  short_version: string;
}

export interface Deployment {
  id: string;
  version: string;
  short_version: string;
  promote_available?: boolean;
  trigger: string;
  status: string;
  created_by: string | null;
  created_at: string;
}

export interface Secret {
  key: string;
  version: number;
  updated_at: string | null;
}

export interface StoredTemplate {
  slug: string;
  channel: 'email' | 'sms';
  language: 'en-US' | 'pt-BR';
  subject?: string | null;
  content: string;
  name?: string | null;
  description?: string | null;
  common?: boolean;
}

export interface TemplateBody {
  slug?: string;
  channel?: string;
  language?: string;
  subject?: string;
  content: string;
  name?: string;
  description?: string;
}

type CommonTemplates = Record<string, { key: string }[]>;

interface Page<T> {
  items: T[];
  total?: number;
}

export interface Scope {
  organization: string;
  project: string;
}

const PAGE_SIZE = 100;

async function allPages<T>(api: Api, path: string, organization: string, filters: Record<string, string> = {}) {
  const items: T[] = [];

  for (let page = 1; ; page++) {
    const result = await api.get<Page<T>>(path, { organization, query: { ...filters, page, page_size: PAGE_SIZE } });
    items.push(...result.items);
    if (result.items.length < PAGE_SIZE || (result.total !== undefined && items.length >= result.total)) return items;
  }
}

const templatesPath = (scope: Scope, environment: string) =>
  `/projects/${encodeURIComponent(scope.project)}/${encodeURIComponent(environment)}/templates`;

const functionPath = (scope: Scope, fn: string) =>
  `/projects/${encodeURIComponent(scope.project)}/functions/${encodeURIComponent(fn)}`;

export const resources = {
  organizations: (api: Api) => api.get<Organization[]>('/organizations'),

  projects: (api: Api, organization: string) => api.get<Project[]>('/projects', { organization }),

  project: (api: Api, scope: Scope) =>
    api.get<Project>(`/projects/${encodeURIComponent(scope.project)}`, { organization: scope.organization }),

  createEnvironment: (api: Api, scope: Scope, environment: { name: string; slug: string }) =>
    api.post<Environment>(`/projects/${encodeURIComponent(scope.project)}/environments`, {
      organization: scope.organization,
      body: environment,
    }),

  deleteEnvironment: (api: Api, scope: Scope, environment: string) =>
    api.delete<void>(`/projects/${encodeURIComponent(scope.project)}/environments/${encodeURIComponent(environment)}`, {
      organization: scope.organization,
    }),

  functions: (api: Api, scope: Scope) =>
    allPages<EdgeFunction>(api, `/projects/${encodeURIComponent(scope.project)}/functions`, scope.organization),

  commonTemplates: (api: Api, scope: Scope) =>
    api.get<CommonTemplates>('/projects/templates/commons', { organization: scope.organization }),

  projectTemplates: (api: Api, scope: Scope, environment: string) =>
    allPages<StoredTemplate>(api, templatesPath(scope, environment), scope.organization, { source: 'project' }),

  createTemplate: (api: Api, scope: Scope, environment: string, body: TemplateBody) =>
    api.post<StoredTemplate>(templatesPath(scope, environment), { organization: scope.organization, body }),

  updateTemplate: (
    api: Api,
    scope: Scope,
    environment: string,
    template: { slug: string; channel: string; language: string },
    body: TemplateBody,
  ) =>
    api.patch<StoredTemplate>(
      `${templatesPath(scope, environment)}/${template.channel}/${encodeURIComponent(template.slug)}/${template.language}`,
      { organization: scope.organization, body },
    ),

  function: (api: Api, scope: Scope, fn: string) =>
    api.get<EdgeFunction>(functionPath(scope, fn), { organization: scope.organization }),

  promoteDeployment: (api: Api, scope: Scope, fn: string, deploymentId: string) =>
    api.post<EdgeFunction>(`${functionPath(scope, fn)}/deployments/${encodeURIComponent(deploymentId)}/promote`, {
      organization: scope.organization,
    }),

  deployments: (api: Api, scope: Scope, fn: string) =>
    allPages<Deployment>(api, `${functionPath(scope, fn)}/deployments`, scope.organization),

  createFunction: (api: Api, scope: Scope, form: FormData) =>
    api.post<EdgeFunction>(`/projects/${encodeURIComponent(scope.project)}/functions`, {
      organization: scope.organization,
      form,
    }),
  updateFunction: (api: Api, scope: Scope, fn: string, form: FormData) =>
    api.put<EdgeFunction>(functionPath(scope, fn), { organization: scope.organization, form }),
  deleteFunction: (api: Api, scope: Scope, fn: string) =>
    api.delete<EdgeFunction>(functionPath(scope, fn), { organization: scope.organization }),

  secrets: (api: Api, scope: Scope, fn: string) => allPages<Secret>(api, `${functionPath(scope, fn)}/secrets`, scope.organization),

  setSecret: (api: Api, scope: Scope, fn: string, key: string, value: string) =>
    api.post<Secret>(`${functionPath(scope, fn)}/secrets`, { organization: scope.organization, body: { key, value } }),

  unsetSecret: (api: Api, scope: Scope, fn: string, key: string) =>
    api.delete<{ removed: boolean }>(`${functionPath(scope, fn)}/secrets/${encodeURIComponent(key)}`, {
      organization: scope.organization,
    }),
};
