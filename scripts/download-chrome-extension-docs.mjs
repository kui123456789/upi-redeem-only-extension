import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const outDir = path.resolve('docs/chrome-extension-dev');
const pagesDir = path.join(outDir, 'pages');
const fetchedAt = new Date().toISOString();
const pageTimeoutMs = 30000;
const execFileAsync = promisify(execFile);
const curlCommand = process.platform === 'win32' ? 'curl.exe' : 'curl';

const pages = [
  ['chrome-extensions-overview', 'Chrome Extensions overview', 'https://developer.chrome.com/docs/extensions'],
  ['get-started', 'Get started', 'https://developer.chrome.com/docs/extensions/get-started'],
  ['hello-world', 'Hello World tutorial', 'https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world'],
  ['develop-overview', 'Develop extensions', 'https://developer.chrome.com/docs/extensions/develop'],
  ['how-to', 'How-to guides', 'https://developer.chrome.com/docs/extensions/how-to'],
  ['api-reference', 'Chrome Extension API reference', 'https://developer.chrome.com/docs/extensions/reference'],
  ['manifest-reference', 'Manifest reference', 'https://developer.chrome.com/docs/extensions/reference/manifest'],
  ['manifest-v3', 'Manifest V3', 'https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3'],
  ['service-workers', 'Extension service workers', 'https://developer.chrome.com/docs/extensions/develop/concepts/service-workers'],
  ['content-scripts', 'Content scripts', 'https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts'],
  ['messaging', 'Message passing', 'https://developer.chrome.com/docs/extensions/develop/concepts/messaging'],
  ['storage-and-cookies', 'Storage and cookies', 'https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies'],
  ['declare-permissions', 'Declare permissions', 'https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions'],
  ['match-patterns', 'Match patterns', 'https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns'],
  ['side-panel-ui', 'Create a side panel', 'https://developer.chrome.com/docs/extensions/develop/ui/create-a-side-panel'],
  ['options-page-ui', 'Options page UI', 'https://developer.chrome.com/docs/extensions/develop/ui/options-page'],
  ['toolbar-ui', 'Implement an action', 'https://developer.chrome.com/docs/extensions/develop/ui/implement-action'],
  ['runtime-api', 'chrome.runtime API', 'https://developer.chrome.com/docs/extensions/reference/api/runtime'],
  ['storage-api', 'chrome.storage API', 'https://developer.chrome.com/docs/extensions/reference/api/storage'],
  ['tabs-api', 'chrome.tabs API', 'https://developer.chrome.com/docs/extensions/reference/api/tabs'],
  ['scripting-api', 'chrome.scripting API', 'https://developer.chrome.com/docs/extensions/reference/api/scripting'],
  ['cookies-api', 'chrome.cookies API', 'https://developer.chrome.com/docs/extensions/reference/api/cookies'],
  ['side-panel-api', 'chrome.sidePanel API', 'https://developer.chrome.com/docs/extensions/reference/api/sidePanel'],
];

function decodeEntities(value) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    copy: '(c)',
    reg: '(R)',
    trade: '(TM)',
    mdash: '-',
    ndash: '-',
    hellip: '...',
  };

  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return named[entity] ?? match;
  });
}

function stripTags(value) {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function cleanChromeDocsNoise(value) {
  return value
    .replace(/Stay organized with collections Save and categorize content based on your preferences\.?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html, fallback) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return cleanChromeDocsNoise(stripTags(h1[1]));

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return cleanChromeDocsNoise(stripTags(title[1]).replace(/\s+\|.*$/, ''));

  return fallback;
}

function extractMainHtml(html) {
  const candidates = [
    /<devsite-content[^>]*>([\s\S]*?)<\/devsite-content>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
  ];

  for (const pattern of candidates) {
    const match = html.match(pattern);
    if (match) return match[1];
  }

  return html;
}

function htmlToMarkdown(html) {
  let value = extractMainHtml(html);

  value = value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<devsite-breadcrumb[\s\S]*?<\/devsite-breadcrumb>/gi, '')
    .replace(/<devsite-feedback[\s\S]*?<\/devsite-feedback>/gi, '')
    .replace(/<devsite-book-nav[\s\S]*?<\/devsite-book-nav>/gi, '')
    .replace(/<devsite-toc[\s\S]*?<\/devsite-toc>/gi, '')
    .replace(/<devsite-code[\s\S]*?<\/devsite-code>/gi, (match) => {
      const code = match.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)?.[1] ?? '';
      return `\n\n\`\`\`\n${stripTags(code)}\n\`\`\`\n\n`;
    })
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => `\n\n\`\`\`\n${stripTags(code)}\n\`\`\`\n\n`)
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => `\n\n\`\`\`\n${stripTags(code)}\n\`\`\`\n\n`)
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, text) => `\n# ${stripTags(text)}\n\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, text) => `\n## ${stripTags(text)}\n\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, text) => `\n### ${stripTags(text)}\n\n`)
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, text) => `\n#### ${stripTags(text)}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `\n- ${stripTags(text)}`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => `\n\n${stripTags(text)}\n\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(section|div|table|tr|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  value = decodeEntities(value)
    .replace(/Stay organized with collections Save and categorize content based on your preferences\.?/g, '')
    .replace(/^\s*- Home\s+- Docs\s+- Chrome Extensions\s+(- [^\n]+\s+)?/i, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return value;
}

async function downloadHtml(url) {
  try {
    const { stdout } = await execFileAsync(
      curlCommand,
      ['-L', '--fail', '--silent', '--show-error', '--compressed', '--max-time', String(Math.ceil(pageTimeoutMs / 1000)), url],
      { timeout: pageTimeoutMs + 5000, maxBuffer: 20 * 1024 * 1024 },
    );

    return stdout;
  } catch (curlError) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), pageTimeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          'accept': 'text/html',
          'user-agent': 'upi-redeem-only-extension-docs-downloader/1.0',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      return await response.text();
    } catch (fetchError) {
      const curlMessage = curlError instanceof Error ? curlError.message : String(curlError);
      const fetchMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
      throw new Error(`curl failed: ${curlMessage}; fetch failed: ${fetchMessage}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function fetchPage(page) {
  const [slug, label, url] = page;
  const html = await downloadHtml(url);
  const title = extractTitle(html, label);
  const body = htmlToMarkdown(html);
  const filename = `${slug}.md`;
  const markdown = [
    `# ${title}`,
    '',
    `Source: ${url}`,
    `Downloaded: ${fetchedAt}`,
    '',
    body.replace(/^# .+?$/m, '').trim(),
    '',
  ].join('\n');

  await writeFile(path.join(pagesDir, filename), markdown, 'utf8');
  return { slug, label, title, url, file: `pages/${filename}`, status: 'ok' };
}

function renderReadme(results) {
  const ok = results.filter((result) => result.status === 'ok');
  const failed = results.filter((result) => result.status !== 'ok');
  const lines = [
    '# Chrome Extension Development Docs',
    '',
    '本目录是 Chrome 插件开发文档的本地离线参考，来源为官方 Chrome for Developers 文档。',
    '',
    `Downloaded: ${fetchedAt}`,
    '',
    '## 使用方式',
    '',
    '- 优先看 `pages/service-workers.md`、`pages/content-scripts.md`、`pages/messaging.md`、`pages/storage-and-cookies.md`，这些和当前扩展项目最相关。',
    '- 需要查 API 时看 `pages/runtime-api.md`、`pages/storage-api.md`、`pages/tabs-api.md`、`pages/scripting-api.md`、`pages/cookies-api.md`。',
    '- 文档可能随 Chrome 更新而变化，最准确版本仍以 `sources.json` 中的官方链接为准。',
    '- 需要刷新本地副本时运行：`node scripts/download-chrome-extension-docs.mjs`。',
    '',
    '## 已下载页面',
    '',
    ...ok.map((result) => `- [${result.title}](${result.file}) - ${result.url}`),
  ];

  if (failed.length) {
    lines.push('', '## 下载失败页面', '');
    lines.push(...failed.map((result) => `- ${result.label} - ${result.url} - ${result.error}`));
  }

  lines.push(
    '',
    '## License',
    '',
    'Chrome for Developers 文档通常以 CC BY 4.0 授权，代码示例通常以 Apache 2.0 授权。具体以各官方页面页脚声明为准。',
    '',
  );

  return lines.join('\n');
}

async function main() {
  await mkdir(pagesDir, { recursive: true });

  const results = [];
  for (const page of pages) {
    try {
      const result = await fetchPage(page);
      results.push(result);
      console.log(`ok ${result.file}`);
    } catch (error) {
      const [slug, label, url] = page;
      const result = {
        slug,
        label,
        url,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(result);
      console.warn(`failed ${url}: ${result.error}`);
    }
  }

  await writeFile(
    path.join(outDir, 'sources.json'),
    JSON.stringify({ fetchedAt, source: 'https://developer.chrome.com/docs/extensions', pages: results }, null, 2),
    'utf8',
  );
  await writeFile(path.join(outDir, 'README.md'), renderReadme(results), 'utf8');

  const failedCount = results.filter((result) => result.status !== 'ok').length;
  if (failedCount) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
