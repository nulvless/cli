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
  status?: string;
  environments: Environment[];
}

export interface EdgeFunction {
  id?: string;
  slug: string;
  name: string;
  status: string;
  version: string;
  short_version: string;
}

export interface PipelineStep {
  name: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  detail?: Record<string, unknown> | null;
}

export interface Deployment {
  id: string;
  context?: 'functions' | 'environments';
  scope?: string;
  metadata?: Record<string, unknown> | null;
  pipeline?: PipelineStep[];
  version: string;
  short_version: string;
  promote_available?: boolean;
  trigger: string;
  status: string;
  created_by: string | null;
  created_at: string;
}

export interface EnvironmentChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ApiKey {
  id: string;
  name: string;
  type: 'public' | 'private';
  alias?: string;
  key?: string | null;
  created_at: string;
}

export interface SigningKey {
  id: string;
  algorithm: string;
  status: string;
  promoted_at: string | null;
  retired_at?: string | null;
}

export interface OAuthSettings {
  enabled: boolean;
  allow_dynamic_clients: boolean;
  authorization_path: string;
  issuer: string;
  authorization_base_url?: string;
  site_url?: string;
}

export interface OAuthClient {
  client_id: string;
  client_name?: string | null;
  client_type: 'public' | 'confidential';
  token_endpoint_auth_method?: string;
  redirect_uris: string[];
  grant_types?: string[];
  client_uri?: string | null;
  logo_uri?: string | null;
  default_max_age?: number | null;
  client_secret?: string | null;
  created_at?: string | null;
}

export interface ServiceHealth {
  service: string;
  status: string;
  latency_ms?: number;
  error?: string | null;
}

export interface Domain {
  hostname: string;
  status: string;
  verification?: string;
  certificate?: string;
  dns?: { type: string; name: string; value: string };
}

export interface Member {
  id: string;
  name?: string;
  email?: string;
  username?: string;
  membership: { id: string; key: string; status: string };
}

export interface MemberRole {
  id: string;
  name: string;
  key?: string;
}

export interface ProjectUser {
  id: string;
  email?: string;
  phone?: { code?: string; number?: string } | string;
  username?: string;
  profile?: { name?: string };
  is_confirmed?: boolean;
  is_banned?: boolean;
  last_sign_in_at?: string | null;
}

export interface UserSession {
  id: string;
  aal?: string;
  created_at: string;
  finger_print?: { browser?: { name?: string }; os?: { name?: string } };
}

export interface UserFactor {
  id: string;
  type: string;
  created_at?: string;
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

const usersPath = (scope: Scope) => `/projects/${encodeURIComponent(scope.project)}/users`;

const environmentPath = (scope: Scope, environment: string) =>
  `/projects/${encodeURIComponent(scope.project)}/${encodeURIComponent(environment)}`;

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

  functionSource: (api: Api, scope: Scope, fn: string) =>
    api.get<{ files: { path: string; content: string }[] }>(`${functionPath(scope, fn)}/source`, {
      organization: scope.organization,
    }),

  revealSecret: (api: Api, scope: Scope, fn: string, key: string) =>
    api.get<{ value: string }>(`${functionPath(scope, fn)}/secrets/${encodeURIComponent(key)}/reveal`, {
      organization: scope.organization,
    }),

  projectDeployments: (api: Api, scope: Scope, filters: Record<string, string>) =>
    allPages<Deployment>(api, `/projects/${encodeURIComponent(scope.project)}/deployments`, scope.organization, filters),

  deployment: (api: Api, scope: Scope, id: string) =>
    api.get<Deployment>(`/projects/${encodeURIComponent(scope.project)}/deployments/${encodeURIComponent(id)}`, {
      organization: scope.organization,
    }),

  environmentsDiff: (api: Api, scope: Scope, origin: string, destination: string) =>
    api.get<Record<string, EnvironmentChange[]>>(
      `/projects/${encodeURIComponent(scope.project)}/diff/${encodeURIComponent(origin)}/into/${encodeURIComponent(destination)}`,
      { organization: scope.organization },
    ),

  mergeEnvironments: (api: Api, scope: Scope, origin: string, destination: string) =>
    api.post<Deployment>(
      `/projects/${encodeURIComponent(scope.project)}/merge/${encodeURIComponent(origin)}/into/${encodeURIComponent(destination)}`,
      { organization: scope.organization },
    ),

  apiKeys: (api: Api, scope: Scope, environment: string) =>
    api.get<ApiKey[]>(`${environmentPath(scope, environment)}/api-keys`, { organization: scope.organization }),

  createApiKey: (api: Api, scope: Scope, environment: string, body: { name: string; type: string }) =>
    api.post<ApiKey>(`${environmentPath(scope, environment)}/api-keys`, { organization: scope.organization, body }),

  revokeApiKey: (api: Api, scope: Scope, environment: string, id: string) =>
    api.delete(`${environmentPath(scope, environment)}/api-keys/${encodeURIComponent(id)}`, {
      organization: scope.organization,
    }),

  signingKeys: (api: Api, scope: Scope, environment: string) =>
    api.get<SigningKey[]>(`${environmentPath(scope, environment)}/auth/signing-keys`, { organization: scope.organization }),

  createSigningKey: (api: Api, scope: Scope, environment: string, body: { algorithm?: string }) =>
    api.post<SigningKey>(`${environmentPath(scope, environment)}/auth/signing-keys`, { organization: scope.organization, body }),

  signingKeyAction: (
    api: Api,
    scope: Scope,
    environment: string,
    kid: string,
    action: 'promote' | 'restore' | 'revoke' | 'delete',
  ) => {
    const path = `${environmentPath(scope, environment)}/auth/signing-keys/${encodeURIComponent(kid)}`;
    const request = { organization: scope.organization };
    if (action === 'promote' || action === 'restore') return api.patch(`${path}/${action}`, request);
    return api.delete(action === 'delete' ? `${path}/permanent` : path, request);
  },

  oauthSettings: (api: Api, scope: Scope, environment: string) =>
    api.get<OAuthSettings>(`${environmentPath(scope, environment)}/oauth/settings`, { organization: scope.organization }),

  updateOAuthSettings: (api: Api, scope: Scope, environment: string, body: Record<string, unknown>) =>
    api.patch<OAuthSettings>(`${environmentPath(scope, environment)}/oauth/settings`, { organization: scope.organization, body }),

  oauthClients: (api: Api, scope: Scope, environment: string) =>
    api.get<OAuthClient[]>(`${environmentPath(scope, environment)}/oauth/clients`, { organization: scope.organization }),

  oauthClient: (api: Api, scope: Scope, environment: string, clientId: string) =>
    api.get<OAuthClient>(`${environmentPath(scope, environment)}/oauth/clients/${encodeURIComponent(clientId)}`, {
      organization: scope.organization,
    }),

  createOAuthClient: (api: Api, scope: Scope, environment: string, body: Record<string, unknown>) =>
    api.post<OAuthClient>(`${environmentPath(scope, environment)}/oauth/clients`, { organization: scope.organization, body }),

  updateOAuthClient: (api: Api, scope: Scope, environment: string, clientId: string, body: Record<string, unknown>) =>
    api.put<OAuthClient>(`${environmentPath(scope, environment)}/oauth/clients/${encodeURIComponent(clientId)}`, {
      organization: scope.organization,
      body,
    }),

  deleteOAuthClient: (api: Api, scope: Scope, environment: string, clientId: string) =>
    api.delete(`${environmentPath(scope, environment)}/oauth/clients/${encodeURIComponent(clientId)}`, {
      organization: scope.organization,
    }),

  rotateOAuthClientSecret: (api: Api, scope: Scope, environment: string, clientId: string) =>
    api.post<OAuthClient>(
      `${environmentPath(scope, environment)}/oauth/clients/${encodeURIComponent(clientId)}/regenerate-secret`,
      { organization: scope.organization },
    ),

  createProject: (api: Api, organization: string, body: { name: string; services: string[] }) =>
    api.post<Project>('/projects', { organization, body }),

  projectAction: (api: Api, organization: string, project: string, action: 'pause' | 'restore') =>
    api.patch<Project>(`/projects/${encodeURIComponent(project)}/${action}`, { organization }),

  deleteProject: (api: Api, organization: string, project: string) =>
    api.delete(`/projects/${encodeURIComponent(project)}`, { organization }),

  projectHealth: (api: Api, scope: Scope) =>
    api.get<ServiceHealth[]>(`/projects/${encodeURIComponent(scope.project)}/health`, { organization: scope.organization }),

  domains: (api: Api, scope: Scope) =>
    api.get<Domain[]>(`/projects/${encodeURIComponent(scope.project)}/domains`, { organization: scope.organization }),

  addDomain: (api: Api, scope: Scope, hostname: string) =>
    api.post<Domain>(`/projects/${encodeURIComponent(scope.project)}/domains`, {
      organization: scope.organization,
      body: { hostname },
    }),

  removeDomain: (api: Api, scope: Scope, hostname: string) =>
    api.delete(`/projects/${encodeURIComponent(scope.project)}/domains/${encodeURIComponent(hostname)}`, {
      organization: scope.organization,
    }),

  members: (api: Api, organization: string) =>
    api.get<Record<string, Member[]>>(`/organizations/${encodeURIComponent(organization)}/members`, { organization }),

  memberRoles: (api: Api, organization: string) => api.get<MemberRole[]>('/organizations/members/roles', { organization }),

  inviteMembers: (
    api: Api,
    organization: string,
    body: { invites: { email: string; role_id: string }[]; redirect_uri: string },
  ) => api.post<Member[]>(`/organizations/${encodeURIComponent(organization)}/members/invites`, { organization, body }),

  removeMember: (api: Api, organization: string, membershipId: string) =>
    api.delete(`/organizations/${encodeURIComponent(organization)}/members/${encodeURIComponent(membershipId)}`, {
      organization,
    }),

  users: (api: Api, scope: Scope, environment: string, filters: Record<string, string>, pageSize: number) =>
    api.get<Page<ProjectUser>>(usersPath(scope), {
      organization: scope.organization,
      query: { environment, ...filters, sort: 'desc', page: 1, page_size: pageSize },
    }),

  user: (api: Api, scope: Scope, environment: string, id: string) =>
    api.get<ProjectUser>(`${usersPath(scope)}/${encodeURIComponent(id)}`, {
      organization: scope.organization,
      query: { environment },
    }),

  createUser: (api: Api, scope: Scope, environment: string, body: Record<string, unknown>) =>
    api.post<ProjectUser>(usersPath(scope), { organization: scope.organization, query: { environment }, body }),

  userAction: (
    api: Api,
    scope: Scope,
    environment: string,
    id: string,
    action: 'ban' | 'unban' | 'delete' | 'sign-out',
  ) => {
    const path = `${usersPath(scope)}/${encodeURIComponent(id)}`;
    const request = { organization: scope.organization, query: { environment } };
    if (action === 'ban' || action === 'unban') return api.patch(`${path}/${action}`, request);
    return api.delete(action === 'sign-out' ? `${path}/sessions` : path, request);
  },

  userSessions: (api: Api, scope: Scope, environment: string, id: string) =>
    api.get<UserSession[]>(`${usersPath(scope)}/${encodeURIComponent(id)}/sessions`, {
      organization: scope.organization,
      query: { environment },
    }),

  userFactors: (api: Api, scope: Scope, environment: string, id: string) =>
    api.get<UserFactor[]>(`${usersPath(scope)}/${encodeURIComponent(id)}/factors`, {
      organization: scope.organization,
      query: { environment },
    }),

  removeUserFactor: (api: Api, scope: Scope, environment: string, id: string, factorId: string) =>
    api.delete(`${usersPath(scope)}/${encodeURIComponent(id)}/factors/${encodeURIComponent(factorId)}`, {
      organization: scope.organization,
      query: { environment },
    }),

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
