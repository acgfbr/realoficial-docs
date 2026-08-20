import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, request as createProxyRequest } from 'node:http';
import { connect } from 'node:net';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicPort = parsePort(
  process.env.DOCS_PUBLIC_PORT ?? process.env.PORT,
  3000,
  'DOCS_PUBLIC_PORT/PORT',
);
const mintlifyPort = parsePort(
  process.env.MINTLIFY_INTERNAL_PORT,
  publicPort === 3001 ? 3002 : 3001,
  'MINTLIFY_INTERNAL_PORT',
);

if (publicPort === mintlifyPort) {
  throw new Error('The public and internal Mintlify ports must be different.');
}

const mintlify = spawn(
  'mintlify',
  ['dev', '--no-open', '--port', String(mintlifyPort)],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  },
);

let shuttingDown = false;

mintlify.once('error', (error) => {
  console.error('Unable to start Mintlify:', error);
  process.exitCode = 1;
});

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const requestUrl = new URL(request.url ?? '/', 'http://docs.local');

      if (requestUrl.pathname === '/openapi.json') {
        await sendFile(request, response, resolve(projectRoot, 'openapi.json'), {
          contentType: 'application/json; charset=utf-8',
          contentDisposition: 'attachment; filename="real-oficial-openapi.json"',
        });
        return;
      }

      if (requestUrl.pathname === '/llms.txt') {
        const content = await buildLlmsIndex(request);
        sendText(request, response, content, 'text/plain; charset=utf-8');
        return;
      }

      if (requestUrl.pathname === '/llms-full.txt') {
        const content = await buildLlmsFull(request);
        sendText(request, response, content, 'text/plain; charset=utf-8');
        return;
      }

      if (requestUrl.pathname.endsWith('.md')) {
        const markdownFile = await findMarkdownSource(requestUrl.pathname);

        if (markdownFile) {
          await sendFile(request, response, markdownFile, {
            contentType: 'text/markdown; charset=utf-8',
          });
          return;
        }
      }
    }

    proxyRequest(request, response);
  } catch (error) {
    console.error('Failed to serve documentation asset:', error);

    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    response.end('Internal documentation server error.');
  }
});

server.on('upgrade', (request, clientSocket, head) => {
  const upstreamSocket = connect(mintlifyPort, '127.0.0.1', () => {
    upstreamSocket.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n`);

    for (const [name, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) upstreamSocket.write(`${name}: ${item}\r\n`);
      } else if (value !== undefined) {
        upstreamSocket.write(`${name}: ${value}\r\n`);
      }
    }

    upstreamSocket.write('\r\n');
    if (head.length > 0) upstreamSocket.write(head);

    clientSocket.pipe(upstreamSocket).pipe(clientSocket);
  });

  upstreamSocket.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstreamSocket.destroy());
});

try {
  await waitForPort(mintlifyPort, 60_000);
  server.listen(publicPort, '0.0.0.0', () => {
    console.log(`Documentation available on http://0.0.0.0:${publicPort}`);
  });
} catch (error) {
  console.error(error);
  mintlify.kill('SIGTERM');
  process.exitCode = 1;
}

mintlify.once('exit', (code, signal) => {
  if (shuttingDown) return;

  console.error(
    `Mintlify exited unexpectedly (${signal ? `signal ${signal}` : `code ${code}`}).`,
  );
  server.close();
  process.exit(code ?? 1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => shutdown(signal));
}

function parsePort(value, fallback, label) {
  if (value === undefined || value === '') return fallback;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} must be an integer between 1 and 65535.`);
  }

  return port;
}

async function findMarkdownSource(pathname) {
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  const relativePath = decodedPath === '/index.md'
    ? 'introduction'
    : decodedPath.slice(1, -extname(decodedPath).length);

  if (!relativePath || relativePath.includes('\\') || relativePath.includes('\0')) {
    return undefined;
  }

  for (const extension of ['.mdx', '.md']) {
    const candidate = resolve(projectRoot, `${relativePath}${extension}`);
    if (!candidate.startsWith(`${projectRoot}${sep}`)) return undefined;

    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Try the next supported source extension.
    }
  }

  return undefined;
}

async function sendFile(request, response, filePath, options) {
  const fileStats = await stat(filePath);
  const headers = {
    'Cache-Control': 'public, max-age=60',
    'Content-Length': String(fileStats.size),
    'Content-Type': options.contentType,
    'X-Content-Type-Options': 'nosniff',
  };

  if (options.contentDisposition) {
    headers['Content-Disposition'] = options.contentDisposition;
  }

  response.writeHead(200, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

function sendText(request, response, content, contentType) {
  const body = Buffer.from(content);
  response.writeHead(200, {
    'Cache-Control': 'public, max-age=60',
    'Content-Length': String(body.length),
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  });

  response.end(request.method === 'HEAD' ? undefined : body);
}

function proxyRequest(request, response) {
  const upstreamRequest = createProxyRequest(
    {
      hostname: '127.0.0.1',
      port: mintlifyPort,
      path: request.url,
      method: request.method,
      headers: request.headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstreamRequest.on('error', (error) => {
    console.error('Mintlify proxy error:', error);

    if (!response.headersSent) {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    response.end('Documentation preview is starting. Please try again shortly.');
  });

  request.pipe(upstreamRequest);
}

async function loadDocumentation() {
  const config = JSON.parse(await readFile(resolve(projectRoot, 'docs.json'), 'utf8'));
  const groups = config.navigation?.groups ?? [];
  const pages = [];

  for (const group of groups) {
    const groupPages = [];

    for (const pagePath of group.pages ?? []) {
      if (typeof pagePath !== 'string') continue;

      const sourcePath = await findMarkdownSource(`/${pagePath}.md`);
      if (!sourcePath) continue;

      const source = await readFile(sourcePath, 'utf8');
      const frontmatter = parseFrontmatter(source);
      const page = {
        path: pagePath,
        title: frontmatter.title ?? pagePath,
        description: frontmatter.description,
        body: stripFrontmatter(source),
      };

      groupPages.push(page);
      pages.push(page);
    }

    group.resolvedPages = groupPages;
  }

  return { config, groups, pages };
}

async function buildLlmsIndex(request) {
  const { config, groups } = await loadDocumentation();
  const origin = getPublicOrigin(request);
  const output = [
    `# ${config.name ?? 'Documentation'}`,
    '',
    `> ${config.description ?? ''}`,
    '',
  ];

  for (const group of groups) {
    if (group.resolvedPages.length === 0) continue;

    output.push(`## ${group.group}`, '');
    for (const page of group.resolvedPages) {
      const description = page.description ? `: ${page.description}` : '';
      output.push(`- [${page.title}](${origin}/${page.path}.md)${description}`);
    }
    output.push('');
  }

  output.push(
    '## OpenAPI Specs',
    '',
    `- [openapi](${origin}/openapi.json)`,
    '',
  );

  return `${output.join('\n')}\n`;
}

async function buildLlmsFull(request) {
  const { config, pages } = await loadDocumentation();
  const origin = getPublicOrigin(request);
  const output = [
    `# ${config.name ?? 'Documentation'}`,
    '',
    `> ${config.description ?? ''}`,
    '',
  ];

  for (const page of pages) {
    output.push(
      `## ${page.title}`,
      '',
      `Source: ${origin}/${page.path}.md`,
      '',
      page.body.trim(),
      '',
    );
  }

  return `${output.join('\n')}\n`;
}

function parseFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};

  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2
      && ((value.startsWith("'") && value.endsWith("'"))
        || (value.startsWith('"') && value.endsWith('"')))
    ) {
      value = value.slice(1, -1);
    }

    fields[key] = value;
  }

  return fields;
}

function stripFrontmatter(source) {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
}

function getPublicOrigin(request) {
  const forwardedProtocol = firstHeaderValue(request.headers['x-forwarded-proto']);
  const forwardedHost = firstHeaderValue(request.headers['x-forwarded-host']);
  const protocol = forwardedProtocol ?? 'http';
  const host = forwardedHost ?? request.headers.host ?? `localhost:${publicPort}`;
  return `${protocol}://${host}`;
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) return value[0];
  return value?.split(',')[0]?.trim();
}

function waitForPort(port, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolvePromise, rejectPromise) => {
    const tryConnection = () => {
      const socket = connect(port, '127.0.0.1');

      socket.once('connect', () => {
        socket.destroy();
        resolvePromise();
      });

      socket.once('error', () => {
        socket.destroy();

        if (Date.now() - startedAt >= timeoutMs) {
          rejectPromise(new Error(`Mintlify did not start on port ${port} within ${timeoutMs}ms.`));
          return;
        }

        setTimeout(tryConnection, 250);
      });
    };

    tryConnection();
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  server.close();
  server.closeAllConnections?.();
  mintlify.kill(signal);

  setTimeout(() => process.exit(0), 5_000).unref();
}
