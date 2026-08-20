#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiReference = join(root, 'api-reference');

const tagNames = {
  auth: 'Autenticação',
  projects: 'Projetos',
  shorts: 'Shorts',
  renders: 'Renders',
  lives: 'Lives',
  'social-accounts': 'Contas sociais',
  'social-posts': 'Publicações sociais',
  launchers: 'Launchers',
  'brand-kits': 'Brand Kits',
  templates: 'Templates',
  library: 'Biblioteca',
  workspaces: 'Workspaces',
  analytics: 'Analytics',
};

const workspaceTags = new Set([
  'Projetos',
  'Shorts',
  'Renders',
  'Lives',
  'Contas sociais',
  'Publicações sociais',
  'Launchers',
  'Brand Kits',
  'Templates',
  'Biblioteca',
  'Workspaces',
  'Analytics',
]);

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function frontmatterValue(source, key) {
  const match = source.match(new RegExp(`^${key}:\\s*['\"]([^'\"]+)['\"]`, 'm'));
  return match?.[1];
}

function stripMdx(value) {
  return value
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function attribute(attributes, name) {
  const match = attributes.match(new RegExp(`${name}=(?:\"([^\"]*)\"|'([^']*)')`));
  return match?.[1] ?? match?.[2];
}

function schemaForType(type = 'string') {
  if (type.includes('|')) {
    return {
      oneOf: type.split('|').map((part) => schemaForType(part.trim())),
    };
  }

  switch (type.toLowerCase()) {
    case 'array':
      return { type: 'array', items: { type: 'string' } };
    case 'boolean':
      return { type: 'boolean' };
    case 'integer':
      return { type: 'integer' };
    case 'number':
      return { type: 'number' };
    case 'json':
    case 'object':
      return { type: 'object', additionalProperties: true };
    default:
      return { type: 'string' };
  }
}

function parseDefault(value, schema) {
  if (value === undefined) return undefined;
  if (schema.type === 'boolean') return value === 'true';
  if (schema.type === 'integer' || schema.type === 'number') return Number(value);
  return value;
}

function parseParamFields(source) {
  const primarySection = source.split(/<RequestExample>|<ResponseExample>/)[0];
  const params = [];
  const pattern = /<ParamField\s+([^>]+)>([\s\S]*?)<\/ParamField>/g;
  let match;

  while ((match = pattern.exec(primarySection))) {
    const attributes = match[1];
    const location = ['body', 'path', 'query', 'header'].find((name) =>
      new RegExp(`${name}=`).test(attributes),
    );
    if (!location) continue;

    const name = attribute(attributes, location);
    if (!name || (location === 'header' && name.toLowerCase() === 'authorization')) continue;

    const schema = schemaForType(attribute(attributes, 'type'));
    const defaultValue = parseDefault(attribute(attributes, 'default'), schema);
    if (defaultValue !== undefined) schema.default = defaultValue;

    params.push({
      name,
      in: location,
      required: location === 'path' || /\brequired\b/.test(attributes),
      description: stripMdx(match[2]),
      schema,
    });
  }

  return params;
}

const string = (description, options = {}) => ({ type: 'string', description, ...options });
const integer = (description, options = {}) => ({ type: 'integer', description, ...options });
const number = (description, options = {}) => ({ type: 'number', description, ...options });
const boolean = (description, options = {}) => ({ type: 'boolean', description, ...options });
const array = (description, items = { type: 'string' }, options = {}) => ({
  type: 'array',
  description,
  items,
  ...options,
});
const object = (description, properties = {}, required = [], options = {}) => ({
  type: 'object',
  description,
  properties,
  ...(required.length ? { required } : {}),
  ...options,
});
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

const schemas = {
  LoginRequest: object(
    'Credenciais do usuário.',
    {
      email: string('Email do usuário.', { format: 'email', example: 'usuario@exemplo.com' }),
      password: string('Senha do usuário.', { format: 'password', writeOnly: true }),
    },
    ['email', 'password'],
  ),
  BrandKitInput: object(
    'Configuração reutilizável de marca.',
    {
      name: string('Nome do Brand Kit.', { maxLength: 255 }),
      format: string('Formato do conteúdo.', { enum: ['vertical', 'horizontal'] }),
      data: object('Logos, marcas d’água e estilos de legenda.', {}, [], { additionalProperties: true }),
    },
    ['name', 'format', 'data'],
  ),
  BrandKitUpdate: object('Campos editáveis do Brand Kit.', {
    name: string('Nome do Brand Kit.', { maxLength: 255 }),
    format: string('Formato do conteúdo.', { enum: ['vertical', 'horizontal'] }),
    data: object('Logos, marcas d’água e estilos de legenda.', {}, [], { additionalProperties: true }),
  }),
  SocialDestination: object(
    'Destino de publicação.',
    {
      id: string('ID da conta social.'),
      title: string('Título específico para a conta.'),
      description: string('Descrição específica para a conta.'),
    },
    ['id'],
  ),
  SocialPostInput: object(
    'Publicação imediata ou agendada.',
    {
      short_id: string('ID do short.'),
      social_accounts: array('Contas de destino.', ref('SocialDestination'), { minItems: 1 }),
      title: string('Título padrão.', { maxLength: 255 }),
      description: string('Descrição padrão.', { maxLength: 5000 }),
      scheduled_at: string('Data futura no fuso America/Sao_Paulo.', {
        example: '2026-08-20 18:30:00',
      }),
      tiktok_guidelines_filter_enabled: boolean('Ativa o filtro de diretrizes do TikTok.', {
        default: true,
      }),
      tags: array('Tags da publicação.', { type: 'string', maxLength: 50 }, { maxItems: 10 }),
      auto_reply_config: object('Configuração opcional de resposta automática.', {}, [], {
        additionalProperties: true,
      }),
    },
    ['short_id', 'social_accounts', 'title'],
  ),
  SocialPostUpdate: object(
    'Campos editáveis da publicação.',
    {
      social_accounts: array('Contas de destino.', ref('SocialDestination'), { minItems: 1 }),
      title: string('Título padrão.', { maxLength: 255 }),
      description: string('Descrição padrão.', { maxLength: 5000 }),
      scheduled_at: string('Data futura no fuso America/Sao_Paulo.'),
      tiktok_guidelines_filter_enabled: boolean('Ativa o filtro de diretrizes do TikTok.'),
      auto_reply_config: object('Configuração opcional de resposta automática.', {}, [], {
        additionalProperties: true,
      }),
    },
    ['social_accounts'],
  ),
  LauncherSlot: object(
    'Horário semanal de publicação.',
    {
      day_of_week: integer('Dia da semana, de 0 (domingo) a 6 (sábado).', {
        minimum: 0,
        maximum: 6,
      }),
      time_of_day: string('Horário no formato HH:mm.', { pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
    },
    ['day_of_week', 'time_of_day'],
  ),
  LauncherInput: object(
    'Configuração da fila automática de publicação.',
    {
      name: string('Nome do Launcher.', { maxLength: 255 }),
      timezone: string('Fuso dos horários.', { default: 'America/Sao_Paulo' }),
      social_account_ids: array('IDs das contas sociais.', { type: 'string' }, { minItems: 1 }),
      slots: array('Horários semanais.', ref('LauncherSlot')),
      default_caption_template: object('Template padrão de legenda.', {}, [], {
        additionalProperties: true,
      }),
      default_tags: array('Tags padrão.', { type: 'string' }),
    },
    ['name', 'social_account_ids'],
  ),
  LauncherUpdate: object('Campos editáveis do Launcher.', {
    name: string('Nome do Launcher.', { maxLength: 255 }),
    timezone: string('Fuso dos horários.'),
    social_account_ids: array('IDs das contas sociais.', { type: 'string' }, { minItems: 1 }),
    slots: array('Horários semanais.', ref('LauncherSlot')),
    status: string('Estado do Launcher.', { enum: ['active', 'paused'] }),
    default_caption_template: object('Template padrão de legenda.', {}, [], {
      additionalProperties: true,
    }),
    default_tags: array('Tags padrão.', { type: 'string' }),
  }),
  LauncherItemInput: object(
    'Short que será incluído na fila.',
    {
      short_id: string('ID do short.'),
      description: string('Descrição padrão.', { maxLength: 5000 }),
      caption_overrides: object('Sobrescritas de legenda por destino.', {}, [], {
        additionalProperties: true,
      }),
      tiktok_guidelines_filter_enabled: boolean('Ativa o filtro do TikTok.', { default: true }),
      auto_reply_config: object('Configuração opcional de resposta automática.', {}, [], {
        additionalProperties: true,
      }),
    },
    ['short_id'],
  ),
  TemplateInput: object(
    'Documento de composição do editor.',
    {
      name: string('Nome do template.', { minLength: 1, maxLength: 120 }),
      description: string('Descrição do template.', { maxLength: 2000 }),
      format: string('Formato do template.', { enum: ['vertical'] }),
      data: object('Documento completo no schema v1.', {}, [], { additionalProperties: true }),
      cover_url: string('URL HTTPS da capa.', { format: 'uri' }),
      forked_from_seed_id: string('ID do template-base do frontend.'),
    },
    ['name', 'format', 'data'],
  ),
  TemplateUpdate: object('Campos editáveis do template.', {
    name: string('Nome do template.', { minLength: 1, maxLength: 120 }),
    description: string('Descrição do template.', { maxLength: 2000 }),
    format: string('Formato do template.', { enum: ['vertical'] }),
    data: object('Documento completo no schema v1.', {}, [], { additionalProperties: true }),
    cover_url: string('URL HTTPS da capa.', { format: 'uri' }),
  }),
  LibraryFolderInput: object(
    'Pasta da Biblioteca.',
    {
      name: string('Nome da pasta.', { maxLength: 255 }),
      visibility: string('Visibilidade.', { enum: ['private', 'public'], default: 'private' }),
    },
    ['name'],
  ),
  LibraryItemInput: object(
    'Metadados de arquivo ou prompt.',
    {
      folder_id: { type: ['string', 'null'], description: 'ID da pasta ou null para a raiz.' },
      type: string('Tipo do item.', { enum: ['file', 'prompt'] }),
      name: string('Nome do item.', { maxLength: 255 }),
      description: string('Descrição do item.', { maxLength: 5000 }),
      visibility: string('Visibilidade.', { enum: ['private', 'public'], default: 'private' }),
      data: object('Dados específicos de arquivo ou prompt.', {}, [], { additionalProperties: true }),
    },
    ['type', 'name', 'data'],
  ),
  WorkspaceInput: object(
    'Workspace de equipe.',
    {
      name: string('Nome do workspace.', { maxLength: 255 }),
      spend_limit: { type: ['integer', 'null'], description: 'Limite global em créditos.' },
      discoverable: boolean('Permite descoberta pública.'),
    },
    ['name'],
  ),
  WorkspaceUpdate: object('Campos editáveis do workspace.', {
    name: string('Nome do workspace.', { maxLength: 255 }),
    spend_limit: { type: ['integer', 'null'], description: 'Limite global em créditos.' },
    discoverable: boolean('Permite descoberta pública.'),
  }),
  WorkspaceInviteInput: object(
    'Convite para o workspace ativo.',
    {
      email: string('Email do convidado.', { format: 'email' }),
      role: string('Papel do membro.', { enum: ['admin', 'publisher', 'editor', 'viewer'] }),
    },
    ['email', 'role'],
  ),
  WorkspaceMemberUpdate: object('Alteração de um membro.', {
    role: string('Papel do membro.', { enum: ['admin', 'publisher', 'editor', 'viewer'] }),
    spend_limit: { type: ['integer', 'null'], description: 'Limite individual em créditos.' },
  }),
  AnalyticsGoalInput: object(
    'Meta de desempenho.',
    {
      metric: string('Métrica acompanhada.', {
        enum: ['views', 'followers', 'posts', 'engagement_rate'],
      }),
      scope: string('Escopo da meta.', { enum: ['total', 'platform', 'account'] }),
      period: string('Período.', { enum: ['weekly', 'monthly', 'quarterly', 'custom'] }),
      target_value: number('Valor-alvo.'),
      starts_at: string('Início do período.', { format: 'date' }),
      ends_at: string('Fim do período.', { format: 'date' }),
    },
    ['metric', 'scope', 'period', 'target_value', 'starts_at', 'ends_at'],
  ),
  GenericResponse: object('Envelope de resposta. O formato exato depende do recurso.', {}, [], {
    additionalProperties: true,
  }),
  Error: object(
    'Erro retornado pela API.',
    {
      error: string('Descrição resumida do erro.'),
      message: string('Mensagem de validação ou contexto adicional.'),
      errors: object('Erros por campo.', {}, [], { additionalProperties: true }),
    },
  ),
};

const bodySchemas = new Map([
  ['POST /login', ref('LoginRequest')],
  [
    'POST /social/connect',
    object(
      'Plataforma que iniciará o OAuth.',
      {
        platform: string('Plataforma social.', {
          enum: [
            'youtube',
            'tiktok',
            'instagram',
            'facebook',
            'twitter',
            'linkedin',
            'threads',
            'reddit',
            'pinterest',
            'bluesky',
          ],
        }),
      },
      ['platform'],
    ),
  ],
  ['POST /social/posts', ref('SocialPostInput')],
  ['PATCH /social/posts/{id}', ref('SocialPostUpdate')],
  ['POST /brand-kits', ref('BrandKitInput')],
  ['PUT /brand-kits/{id}', ref('BrandKitUpdate')],
  ['POST /launchers', ref('LauncherInput')],
  ['PUT /launchers/{id}', ref('LauncherUpdate')],
  [
    'PUT /launchers/{id}/slots',
    object('Nova grade semanal.', { slots: array('Horários semanais.', ref('LauncherSlot')) }, [
      'slots',
    ]),
  ],
  ['POST /launchers/{id}/items', ref('LauncherItemInput')],
  [
    'PUT /launchers/{id}/items/reorder',
    object(
      'Nova ordem completa da fila.',
      { item_ids: array('IDs dos itens na ordem desejada.', { type: 'string' }, { minItems: 1 }) },
      ['item_ids'],
    ),
  ],
  [
    'PUT /launchers/{id}/items/reschedule',
    object(
      'Deslocamento de itens da fila.',
      {
        item_ids: array('IDs dos itens.', { type: 'string' }, { minItems: 1 }),
        days: integer('Quantidade de dias, diferente de zero.', { minimum: -365, maximum: 365 }),
      },
      ['item_ids', 'days'],
    ),
  ],
  [
    'POST /launchers/{id}/suggest-description',
    object('Short usado para gerar a sugestão.', { short_id: string('ID do short.') }, ['short_id']),
  ],
  ['POST /templates', ref('TemplateInput')],
  ['PATCH /templates/{id}', ref('TemplateUpdate')],
  [
    'POST /templates/{id}/copy',
    object('Personalização opcional da cópia.', {
      name: string('Nome da cópia.'),
      description: string('Descrição da cópia.'),
    }),
  ],
  ['POST /library/folders', ref('LibraryFolderInput')],
  ['PUT /library/folders/{id}', ref('LibraryFolderInput')],
  ['POST /library/items', ref('LibraryItemInput')],
  ['PUT /library/items/{id}', ref('LibraryItemInput')],
  ['POST /workspace', ref('WorkspaceInput')],
  ['PATCH /workspace', ref('WorkspaceUpdate')],
  ['POST /workspace/invites', ref('WorkspaceInviteInput')],
  ['PATCH /workspace/members/{memberId}', ref('WorkspaceMemberUpdate')],
  ['POST /dashboard/analytics/goals', ref('AnalyticsGoalInput')],
  ['PUT /dashboard/analytics/goals/{id}', ref('AnalyticsGoalInput')],
]);

const optionalRequestBodies = new Set(['POST /templates/{id}/copy']);

const query = (name, description, schema = { type: 'string' }, required = false) => ({
  name,
  in: 'query',
  description,
  required,
  schema,
});

const pagination = [
  query('page', 'Página solicitada.', { type: 'integer', minimum: 1, default: 1 }),
  query('limit', 'Quantidade de itens por página.', { type: 'integer', minimum: 1 }),
];

const extraParameters = new Map([
  ['GET /social/accounts', pagination],
  [
    'GET /social/posts',
    [
      query('limit', 'Itens por página.', { type: 'integer', minimum: 1, maximum: 1000, default: 20 }),
      query('status', 'Status ou lista separada por vírgulas.', {
        type: 'string',
        example: 'scheduled,failed',
      }),
    ],
  ],
  [
    'GET /templates/public',
    [
      query('format', 'Formato.', { type: 'string', enum: ['vertical'] }),
      query('sort', 'Ordenação.', { type: 'string', enum: ['popular', 'recent'], default: 'popular' }),
      query('q', 'Busca por nome.', { type: 'string' }),
      query('page', 'Página.', { type: 'integer', minimum: 1, default: 1 }),
      query('pageSize', 'Itens por página.', { type: 'integer', minimum: 1, maximum: 60, default: 24 }),
    ],
  ],
  [
    'GET /library/items',
    [
      ...pagination,
      query('folder_id', 'ID da pasta; vazio ou null seleciona a raiz.', { type: 'string' }),
      query('type', 'Tipo do item.', { type: 'string', enum: ['file', 'prompt'] }),
    ],
  ],
  [
    'GET /library/folders/{id}/items',
    [...pagination, query('type', 'Tipo do item.', { type: 'string', enum: ['file', 'prompt'] })],
  ],
  ['GET /library/public/folders', pagination],
  [
    'GET /library/public/folders/{id}/items',
    [...pagination, query('type', 'Tipo do item.', { type: 'string', enum: ['file', 'prompt'] })],
  ],
  [
    'GET /library/public/items',
    [
      ...pagination,
      query('folder_id', 'ID da pasta.', { type: 'string' }),
      query('type', 'Tipo do item.', { type: 'string', enum: ['file', 'prompt'] }),
    ],
  ],
]);

const analyticsCommon = [
  query('range', 'Janela em dias.', { type: 'integer', enum: [30, 60, 90], default: 30 }),
  query('platforms', 'Plataformas separadas por vírgulas.', { type: 'string' }),
  query('social_account_ids', 'IDs de contas separados por vírgulas.', { type: 'string' }),
];

const analyticsSpecific = new Map([
  [
    '/dashboard/analytics/posts',
    [
      query('sortBy', 'Campo de ordenação.', {
        type: 'string',
        enum: ['date', 'views', 'impressions', 'likes', 'comments', 'shares', 'engagement'],
      }),
      query('order', 'Direção da ordenação.', { type: 'string', enum: ['asc', 'desc'] }),
      ...pagination,
    ],
  ],
  [
    '/dashboard/analytics/top-posts',
    [
      query('metric', 'Métrica usada no ranking.', {
        type: 'string',
        enum: ['views', 'impressions', 'likes', 'comments', 'shares', 'engagement_rate'],
      }),
      query('limit', 'Quantidade de posts.', { type: 'integer', minimum: 1, maximum: 50 }),
    ],
  ],
  [
    '/dashboard/analytics/best-time',
    [
      query('metric', 'Métrica analisada.', {
        type: 'string',
        enum: ['views', 'likes', 'engagement_rate'],
      }),
      query('scope', 'Escopo da análise.', { type: 'string', enum: ['user', 'global'] }),
    ],
  ],
  [
    '/dashboard/analytics/instagram/demographics',
    [
      query('social_account_id', 'ID da conta do Instagram.', { type: 'string' }, true),
      query('metric', 'Métrica demográfica.', {
        type: 'string',
        enum: ['follower_demographics', 'engaged_audience_demographics'],
      }),
    ],
  ],
  [
    '/dashboard/analytics/repurpose-suggestions',
    [
      query('min_views', 'Mínimo de visualizações.', { type: 'integer', default: 5000 }),
      query('age_days_min', 'Idade mínima em dias.', { type: 'integer', minimum: 7, default: 30 }),
      query('limit', 'Quantidade de sugestões.', {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        default: 20,
      }),
    ],
  ],
  [
    '/dashboard/analytics/export',
    [query('type', 'Conjunto exportado.', { type: 'string', enum: ['posts', 'platforms', 'accounts'] }, true)],
  ],
]);

const paths = {};
const operationIds = new Set();

function operationId(method, path) {
  const base = `${method.toLowerCase()}_${path}`
    .replace(/\{([^}]+)}/g, 'by_$1')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  let candidate = base;
  let suffix = 2;
  while (operationIds.has(candidate)) candidate = `${base}_${suffix++}`;
  operationIds.add(candidate);
  return candidate;
}

function successfulStatus(method, path) {
  if (path === '/templates/{id}/use') return '204';
  if (method === 'POST' && /(^\/login$|\/render$|\/retry|\/pause$|\/resume$|\/favorite$|\/publish$|\/unpublish$|\/copy$|\/duplicate$)/.test(path)) {
    return '200';
  }
  if (method === 'POST') return '201';
  return '200';
}

function responseFor(method, path) {
  if (method === 'GET' && path === '/dashboard/analytics/export') {
    return {
      '200': {
        description: 'Arquivo CSV.',
        content: { 'text/csv': { schema: { type: 'string' } } },
      },
      default: { $ref: '#/components/responses/Error' },
    };
  }

  const status = successfulStatus(method, path);
  return {
    [status]:
      status === '204'
        ? { description: 'Operação concluída sem corpo de resposta.' }
        : {
            description: 'Operação concluída com sucesso.',
            content: { 'application/json': { schema: ref('GenericResponse') } },
          },
    default: { $ref: '#/components/responses/Error' },
  };
}

function addOperation({ method, path, summary, description, tag, params = [], source }) {
  const key = `${method} ${path}`;
  const pathParams = [...path.matchAll(/\{([^}]+)}/g)].map((match) => match[1]);
  const explicit = params.filter((param) => param.in !== 'body');

  for (const name of pathParams) {
    if (!explicit.some((param) => param.in === 'path' && param.name === name)) {
      explicit.push({
        name,
        in: 'path',
        required: true,
        description: `Identificador ${name}.`,
        schema: { type: 'string' },
      });
    }
  }

  for (const extra of extraParameters.get(key) ?? []) {
    if (!explicit.some((param) => param.in === extra.in && param.name === extra.name)) {
      explicit.push(extra);
    }
  }

  if (tag === 'Analytics' && method === 'GET' && !path.includes('/goals')) {
    for (const param of [...analyticsCommon, ...(analyticsSpecific.get(path) ?? [])]) {
      if (!explicit.some((item) => item.in === param.in && item.name === param.name)) explicit.push(param);
    }
  }

  if (workspaceTags.has(tag)) {
    explicit.unshift({ $ref: '#/components/parameters/WorkspaceId' });
  }

  const bodyFields = params.filter((param) => param.in === 'body');
  let bodySchema = bodySchemas.get(key);
  if (!bodySchema && bodyFields.length) {
    const properties = Object.fromEntries(
      bodyFields.map((param) => [
        param.name,
        { ...param.schema, ...(param.description ? { description: param.description } : {}) },
      ]),
    );
    bodySchema = object(
      'Corpo da requisição.',
      properties,
      bodyFields.filter((param) => param.required).map((param) => param.name),
    );
  }

  paths[path] ??= {};
  paths[path][method.toLowerCase()] = {
    tags: [tag],
    summary,
    description,
    operationId: operationId(method, path),
    ...(source ? { 'x-docs-source': source } : {}),
    ...(explicit.length ? { parameters: explicit } : {}),
    ...(bodySchema
      ? {
          requestBody: {
            required: !optionalRequestBodies.has(key),
            content: { 'application/json': { schema: bodySchema } },
          },
        }
      : {}),
    responses: responseFor(method, path),
    security: path === '/login' ? [] : [{ bearerAuth: [] }],
  };
}

for (const file of filesUnder(apiReference).filter((path) => path.endsWith('.mdx')).sort()) {
  const source = readFileSync(file, 'utf8');
  const api = frontmatterValue(source, 'api');
  if (!api) continue;

  const [method, path] = api.split(/\s+/, 2);
  const relativePath = relative(root, file).replaceAll('\\', '/');
  const section = relative(apiReference, file).split(/[\\/]/)[0].replace(/\.mdx$/, '');
  addOperation({
    method,
    path,
    summary: frontmatterValue(source, 'title') ?? `${method} ${path}`,
    description: frontmatterValue(source, 'description') ?? `Operação ${method} ${path}.`,
    tag: tagNames[section] ?? section,
    params: parseParamFields(source),
    source: relativePath,
  });
}

const supplemental = [
  ['POST', '/login', 'Login', 'Autentica um usuário e retorna seu token permanente.', 'Autenticação'],
  ['DELETE', '/projects/{projectId}', 'Excluir projeto', 'Exclui um projeto que esteja em um estado final aceito.', 'Projetos'],
  ['GET', '/shorts/{projectId}/{shortId}', 'Detalhar short', 'Retorna o short completo, incluindo sua timeline.', 'Shorts'],
  [
    'POST',
    '/readonly/shorts/{projectId}/{shortId}/updateTimeline',
    'Atualizar timeline compartilhada',
    'Atualiza a timeline usando um read_only_token como Bearer token.',
    'Shorts',
  ],
  ['GET', '/workspaces', 'Listar workspaces', 'Lista o espaço pessoal e os workspaces acessíveis.', 'Workspaces'],
  ['GET', '/workspace', 'Detalhar workspace ativo', 'Retorna o workspace selecionado pelo header X-Workspace-Id.', 'Workspaces'],
  ['POST', '/workspace', 'Criar workspace', 'Cria um workspace de equipe.', 'Workspaces'],
  ['PATCH', '/workspace', 'Atualizar workspace', 'Atualiza o workspace ativo.', 'Workspaces'],
  ['DELETE', '/workspace', 'Excluir workspace', 'Exclui o workspace ativo e devolve seus recursos ao espaço pessoal do dono.', 'Workspaces'],
  ['POST', '/workspace/invites', 'Convidar membro', 'Convida um membro para o workspace ativo.', 'Workspaces'],
  ['POST', '/workspace/invites/{token}/accept', 'Aceitar convite', 'Aceita um convite do próprio email.', 'Workspaces'],
  ['POST', '/workspace/invites/{token}/decline', 'Recusar convite', 'Recusa um convite de workspace.', 'Workspaces'],
  ['POST', '/workspace/leave', 'Sair do workspace', 'Remove o usuário autenticado do workspace ativo.', 'Workspaces'],
  ['PATCH', '/workspace/members/{memberId}', 'Atualizar membro', 'Altera papel ou limite de gasto do membro.', 'Workspaces'],
  ['DELETE', '/workspace/members/{memberId}', 'Remover membro', 'Remove um membro do workspace ativo.', 'Workspaces'],
  ['GET', '/workspaces/discover', 'Descobrir workspaces', 'Lista workspaces publicamente descobríveis.', 'Workspaces'],
  ['POST', '/workspaces/{workspaceId}/join-request', 'Solicitar entrada', 'Solicita entrada em um workspace descobrível.', 'Workspaces'],
];

const analyticsEndpoints = [
  ['GET', '/overview', 'Visão geral', 'KPIs de visualizações, shorts, minutos e origem dos dados.'],
  ['GET', '/posts', 'Desempenho de posts', 'Lista paginada de posts e métricas.'],
  ['GET', '/timeseries', 'Série temporal', 'Retorna a série temporal do período.'],
  ['GET', '/top-posts', 'Top posts', 'Retorna os posts de melhor desempenho.'],
  ['GET', '/platforms', 'Comparar plataformas', 'Compara o desempenho por plataforma.'],
  ['GET', '/accounts', 'Comparar contas', 'Compara o desempenho por conta social.'],
  ['GET', '/best-time', 'Melhor horário', 'Retorna horários de melhor desempenho.'],
  ['GET', '/fatigue', 'Fadiga de conteúdo', 'Retorna sinais de fadiga de conteúdo.'],
  ['GET', '/follower-growth', 'Crescimento de seguidores', 'Retorna o crescimento de seguidores.'],
  ['GET', '/youtube/post/{socialPostId}/daily', 'Views diárias no YouTube', 'Retorna visualizações diárias de um post do YouTube.'],
  ['GET', '/instagram/demographics', 'Demografia do Instagram', 'Retorna métricas demográficas do Instagram.'],
  ['GET', '/content-decay', 'Decaimento de conteúdo', 'Analisa o decaimento de desempenho.'],
  ['GET', '/repurpose-suggestions', 'Sugestões de reaproveitamento', 'Sugere conteúdos para reaproveitar.'],
  ['GET', '/hashtag-trends', 'Tendências de hashtags', 'Retorna tendências de hashtags.'],
  ['GET', '/competitor-benchmark', 'Benchmark de concorrentes', 'Compara o desempenho com concorrentes.'],
  ['GET', '/posts/{socialPostId}/sentiment', 'Sentimento dos comentários', 'Analisa o sentimento dos comentários.'],
  ['GET', '/export', 'Exportar Analytics', 'Exporta dados de Analytics em CSV.'],
];

for (const endpoint of analyticsEndpoints) {
  supplemental.push([
    endpoint[0],
    `/dashboard/analytics${endpoint[1]}`,
    endpoint[2],
    endpoint[3],
    'Analytics',
  ]);
}

supplemental.push(
  ['GET', '/dashboard/analytics/goals', 'Listar metas', 'Lista metas de desempenho.', 'Analytics'],
  ['POST', '/dashboard/analytics/goals', 'Criar meta', 'Cria uma meta de desempenho.', 'Analytics'],
  ['PUT', '/dashboard/analytics/goals/{id}', 'Atualizar meta', 'Atualiza uma meta de desempenho.', 'Analytics'],
  ['DELETE', '/dashboard/analytics/goals/{id}', 'Arquivar meta', 'Arquiva uma meta de desempenho.', 'Analytics'],
);

for (const [method, path, summary, description, tag] of supplemental) {
  if (paths[path]?.[method.toLowerCase()]) continue;
  addOperation({
    method,
    path,
    summary,
    description,
    tag,
    source:
      tag === 'Analytics'
        ? 'api-reference/analytics.mdx'
        : tag === 'Workspaces'
          ? 'api-reference/workspaces.mdx'
          : undefined,
  });
}

const sortedPaths = Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b)));
const usedTags = [...new Set(Object.values(sortedPaths).flatMap((path) => Object.values(path).flatMap((op) => op.tags)))];

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Real Oficial API',
    summary: 'API para criar, editar, renderizar e publicar cortes de vídeo.',
    description:
      'Contrato público da API v1 da Real Oficial. Envie Accept: application/json em todas as requisições e use X-Workspace-Id para selecionar um workspace de equipe.',
    version: '1.0.0',
    contact: {
      name: 'Suporte Real Oficial',
      email: 'antonio@realoficial.com.br',
      url: 'https://discord.gg/realoficial',
    },
  },
  servers: [{ url: 'https://api.realoficial.com.br/api/v1', description: 'Produção' }],
  security: [{ bearerAuth: [] }],
  tags: usedTags.map((name) => ({ name })),
  paths: sortedPaths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Token permanente obtido no login ou no dashboard.',
      },
    },
    parameters: {
      WorkspaceId: {
        name: 'X-Workspace-Id',
        in: 'header',
        required: false,
        description: 'ULID do workspace. Quando omitido, usa o espaço pessoal.',
        schema: { type: 'string' },
      },
    },
    schemas,
    responses: {
      Error: {
        description: 'Erro de autenticação, permissão, validação, limite ou regra de negócio.',
        content: { 'application/json': { schema: ref('Error') } },
      },
    },
  },
};

process.stdout.write(`${JSON.stringify(spec, null, 2)}\n`);
