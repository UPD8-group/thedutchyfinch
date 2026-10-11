import { cp, mkdir, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
let html = await readFile('public/index.html', 'utf8');
// A new script URL accompanies each change, including for returning mobile
// visitors whose browser retained an older copy of the introduction code.
const mainScript = await readFile('public/main.js');
const mainName = `main.${createHash('sha256').update(mainScript).digest('hex').slice(0, 12)}.js`;
await writeFile(`dist/${mainName}`, mainScript);
html = html.replace('src="/main.js"', `src="/${mainName}"`);
const siteOrigin = new URL(process.env.URL || process.env.SITE_URL || 'https://the-dutchy-finch.hello490589.chatgpt.site').origin;
html = html.replace('content="/assets/finch-colour-1600.webp"', `content="${siteOrigin}/assets/finch-colour-1600.webp"`)
  .replace('<meta property="og:type" content="website">', `<meta property="og:type" content="website">\n  <meta property="og:url" content="${siteOrigin}/">\n  <link rel="canonical" href="${siteOrigin}/">`);
await writeFile('dist/index.html', html);

// oo.studio proxies this directory at the same path. Generate it from the
// existing site on every build so the branded demo stays in sync with the shop.
const demoBase = '/demo/dutchyfinch';
const demoDirectory = `dist${demoBase}`;
await cp('public', demoDirectory, { recursive: true });
await rm(`${demoDirectory}/_headers`);
await writeFile(`${demoDirectory}/index.html`, html);
await writeFile(`${demoDirectory}/${mainName}`, mainScript);

function prefixUrl(url) {
  return url.startsWith('/') && !url.startsWith('//') ? `${demoBase}${url}` : url;
}

function rewriteTag(tag) {
  return tag.replace(/(\s)([\w:-]+)=(['"])(.*?)\3/g, (attribute, space, name, quote, value) => {
    let rewritten = value;
    if (name === 'srcset') {
      rewritten = value.replace(/(^|,)(\s*)(\S+)/g, (_, separator, padding, url) => `${separator}${padding}${prefixUrl(url)}`);
    } else if (['href', 'src', 'poster'].includes(name) || name.startsWith('data-')) {
      rewritten = prefixUrl(value);
    }
    return `${space}${name}=${quote}${rewritten}${quote}`;
  });
}

async function prepareDemo(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      await prepareDemo(file);
    } else if (entry.name.endsWith('.html')) {
      const original = await readFile(file, 'utf8');
      // Leave inline script bodies byte-identical so their CSP hashes remain
      // valid. Only URL attributes in markup need the demo path.
      let page = original.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)|<[^>]+>/gi,
        (tag, opening, body, closing) => opening ? `${rewriteTag(opening)}${body}${closing}` : rewriteTag(tag));
      if (!/<meta\s+name=['"]robots['"]/i.test(page)) {
        page = page.replace('</head>', '<meta name="robots" content="noindex">\n</head>');
      }
      await writeFile(file, page);
    } else if (entry.name.endsWith('.css')) {
      const css = await readFile(file, 'utf8');
      await writeFile(file, css.replace(/(url\(\s*['"]?)(\/(?!\/)[^\s)'";]+)/g,
        (_, opening, url) => `${opening}${prefixUrl(url)}`));
    }
  }
}
await prepareDemo(demoDirectory);

const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .filter((match) => match[1].trim())
  .map((match) => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
const headers = await readFile('public/_headers', 'utf8');
await writeFile('dist/_headers', headers.replace('__INLINE_SCRIPT_HASHES__', hashes.join(' ')));
await import('./check-build.mjs');
console.log('Built The Dutchy Finch and its oo.studio demo into dist/. No production dependencies.');
