import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = path.join(project, 'public');
const outputRoot = path.join(project, 'dist');
const demo = '/demo/dutchyfinch/';
const mediaAttributes = new Set(['data-desktop-src', 'data-mobile-src', 'data-opening-desktop',
  'data-opening-mobile', 'data-colour-desktop', 'data-colour-mobile', 'data-fallback-src']);
const read = (root, file) => readFile(path.join(root, file), 'utf8');
const hash = (value) => `'sha256-${createHash('sha256').update(value).digest('base64')}'`;

async function walk(root, prefix = '') {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const name = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? walk(root, name) : [name];
  }))).flat();
}

const sourceFiles = await walk(sourceRoot);
const outputFiles = new Set(await walk(outputRoot));
const decode = (value) => value.replace(/&(?:amp|quot|apos|lt|gt);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
  const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
  return named[entity.toLowerCase()] ?? String.fromCodePoint(
    entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1)));
});

// These static pages use ordinary quoted attributes; omit script text when
// collecting tags so JavaScript strings cannot masquerade as HTML resources.
function tags(html) {
  const markup = html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');
  return [...markup.matchAll(/<([a-z][\w:-]*)\b([^<>]*)>/gi)].map((match) => ({
    name: match[1].toLowerCase(),
    attrs: Object.fromEntries([...match[2].matchAll(/([^\s="'<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
      .map((attribute) => [attribute[1].toLowerCase(), decode(attribute[2] ?? attribute[3])])),
  }));
}

function inlineScripts(html) {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]).filter((script) => script.trim());
}

function checkResource(reference, base, prefix, label) {
  if (!reference || reference.startsWith('#') || /^(?:data|blob):/i.test(reference)) return;
  const url = new URL(reference, base);
  assert.equal(url.origin, base.origin, `Cross-origin resource in ${label}: ${reference}`);
  assert(url.pathname.startsWith(prefix), `Demo resource escapes its mount in ${label}: ${reference}`);
  if (prefix === '/') assert(!url.pathname.startsWith(demo), `Root resource depends on demo in ${label}`);
  let filename = decodeURIComponent(url.pathname.slice(1));
  if (filename.endsWith('/') || !filename) filename += 'index.html';
  assert(outputFiles.has(filename), `Missing built resource in ${label}: ${reference}`);
}

function headerRules(text) {
  const rules = [];
  let current;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), values: [] };
      rules.push(current);
    } else {
      const match = line.trim().match(/^([^:]+):\s*(.*)$/);
      assert(current && match, `Malformed generated header: ${line}`);
      current.values.push([match[1].toLowerCase(), match[2]]);
    }
  }
  return rules;
}
const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const headersText = await read(outputRoot, '_headers');
assert(!headersText.includes('__INLINE_SCRIPT_HASHES__'), 'Unresolved CSP hash placeholder');
const rules = headerRules(headersText);
function headersFor(pathname, name) {
  return rules.filter(({ pattern }) => new RegExp(`^${pattern.split('*').map(escapePattern).join('.*')}$`).test(pathname))
    .flatMap(({ values }) => values.filter(([key]) => key === name).map(([, value]) => value));
}

const home = await read(outputRoot, 'index.html');
const canonicalTag = (html) => tags(html).filter((tag) => tag.name === 'link' && tag.attrs.rel === 'canonical');
assert.equal(canonicalTag(home).length, 1, 'Root homepage must have one canonical URL');
const canonical = new URL(canonicalTag(home)[0].attrs.href);
assert.equal(canonical.href, `${canonical.origin}/`, 'Root canonical must identify the original homepage');
const configuredOrigin = process.env.URL || process.env.SITE_URL;
if (configuredOrigin) assert.equal(canonical.origin, new URL(configuredOrigin).origin, 'Canonical origin changed');
assert(!headersFor('/', 'x-robots-tag').some((value) => /\bnoindex\b/i.test(value)), 'Demo noindex leaked to root');
assert(!outputFiles.has(`${demo.slice(1)}_headers`), 'Demo must not contain a nested _headers file');

for (const sourceFile of sourceFiles.filter((file) => file.endsWith('.html'))) {
  const original = await read(sourceRoot, sourceFile);
  const originalLinks = tags(original).filter((tag) => tag.name === 'a').map((tag) => tag.attrs.href);
  for (const prefix of ['/', demo]) {
    const file = prefix.slice(1) + sourceFile;
    const html = await read(outputRoot, file);
    const nodes = tags(html);
    // A 404 is displayed at an arbitrary missing URL, not at /404.html.
    const route = sourceFile === '404.html' ? 'missing/nested/' : sourceFile.replace(/index\.html$/, '');
    const base = new URL(prefix + route, prefix === demo ? 'https://oo.studio/' : canonical.origin);
    assert.deepEqual(inlineScripts(html), inlineScripts(original), `Inline scripts changed in ${file}`);
    const policies = headersFor(base.pathname, 'content-security-policy');
    assert(policies.length, `Missing CSP for ${file}`);
    for (const policy of policies) {
      const directives = new Map(policy.split(';').filter((part) => part.trim()).map((part) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name, values];
      }));
      const scripts = directives.get('script-src') || directives.get('default-src') || [];
      for (const script of inlineScripts(html)) assert(scripts.includes(hash(script)), `CSP blocks inline script in ${file}`);
      for (const type of ['script-src', 'style-src', 'font-src', 'media-src', 'connect-src']) {
        assert(directives.get(type)?.includes("'self'"), `CSP blocks local ${type} in ${file}`);
      }
      assert(directives.get('img-src')?.includes('blob:'), `CSP blocks animated image URLs in ${file}`);
    }
    if (prefix === demo) {
      assert(headersFor(base.pathname, 'x-robots-tag').some((value) => /\bnoindex\b/i.test(value)), `Missing demo noindex for ${file}`);
    }
    const builtLinks = nodes.filter((tag) => tag.name === 'a').map((tag) => tag.attrs.href);
    assert.deepEqual(builtLinks.map((href) => new URL(href, base).href), originalLinks.map((href) => {
      const target = href.startsWith('/') && !href.startsWith('//') ? prefix + href.slice(1) : href;
      return new URL(target, base).href;
    }), `Navigation or gallery links changed destination in ${file}`);
    for (const tag of nodes) {
      for (const [name, value] of Object.entries(tag.attrs)) {
        if (name === 'srcset') {
          for (const candidate of value.split(',')) checkResource(candidate.trim().split(/\s+/)[0], base, prefix, file);
        } else if (['src', 'poster'].includes(name) || mediaAttributes.has(name)
          || (name === 'href' && tag.name !== 'a' && tag.attrs.rel !== 'canonical')) {
          checkResource(value, base, prefix, file);
        } else if (name === 'href' && tag.name === 'a' && !/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(value)) {
          checkResource(value, base, prefix, file);
        }
      }
    }
    if (sourceFile === 'index.html') {
      assert.equal(canonicalTag(html).length, 1, `Missing or duplicate canonical in ${file}`);
      assert.equal(canonicalTag(html)[0].attrs.href, canonical.href, `Demo changed canonical identity in ${file}`);
      const meta = Object.fromEntries(nodes.filter((tag) => tag.name === 'meta').map((tag) => [tag.attrs.property, tag.attrs.content]));
      assert.equal(meta['og:url'], canonical.href, `Open Graph URL changed in ${file}`);
      assert.equal(meta['og:image'], new URL('/assets/finch-colour-1600.webp', canonical).href, `Open Graph image changed in ${file}`);
    }
  }
}

for (const sourceFile of sourceFiles.filter((file) => file.endsWith('.css'))) {
  for (const prefix of ['/', demo]) {
    const file = prefix.slice(1) + sourceFile;
    const css = await read(outputRoot, file);
    const base = new URL(prefix + sourceFile, prefix === demo ? 'https://oo.studio/' : canonical.origin);
    for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi)) {
      checkResource(match[1] ?? match[2] ?? match[3], base, prefix, file);
    }
  }
}

const main = await readFile(path.join(sourceRoot, 'main.js'));
const mainName = `main.${createHash('sha256').update(main).digest('hex').slice(0, 12)}.js`;
for (const prefix of ['/', demo]) {
  const html = await read(outputRoot, `${prefix.slice(1)}index.html`);
  const scripts = tags(html).filter((tag) => tag.name === 'script' && tag.attrs.src).map((tag) => tag.attrs.src);
  assert(scripts.includes(prefix + mainName), `Homepage does not load the current hashed script at ${prefix}`);
  assert((await readFile(path.join(outputRoot, prefix.slice(1), mainName))).equals(main), `Hashed main script changed at ${prefix}`);
}
for (const file of sourceFiles.filter((name) => name.startsWith('assets/') || name.endsWith('.js'))) {
  const bytes = await readFile(path.join(sourceRoot, file));
  for (const prefix of ['', demo.slice(1)]) {
    assert((await readFile(path.join(outputRoot, prefix, file))).equals(bytes), `Copied file bytes changed: ${prefix}${file}`);
  }
}

const config = await read(project, 'netlify.toml');
const redirects = config.split(/^\s*\[\[redirects\]\]\s*$/m).slice(1).map((block) =>
  Object.fromEntries([...block.matchAll(/^\s*(from|to|status|force)\s*=\s*("[^"]*"|'[^']*'|\d+|true|false)\s*(?:#.*)?$/gm)]
    .map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, '')])));
assert(redirects.some((rule) => rule.from === `${demo}*` && rule.to === `${demo}404.html`
  && rule.status === '404' && rule.force !== 'true'), 'Missing nonforced, scoped demo 404 fallback');
console.log('Checked root and demo builds: local URLs, navigation, unchanged media/scripts, CSP, canonical URLs and demo routing.');
