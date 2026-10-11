import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = path.resolve('public');
async function walk(dir) {
  const found = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) found.push(...await walk(file));
    else found.push(file);
  }
  return found;
}
const files = await walk(root);
for (const file of files) assert((await stat(file)).size > 0, `Empty file: ${file}`);
for (const file of files.filter((item) => item.endsWith('.html'))) {
  const html = await readFile(file, 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `Duplicate ID in ${file}`);
  assert(html.includes('lang="en-AU"'), `Missing language in ${file}`);
  assert(html.includes('name="viewport"'), `Missing viewport in ${file}`);
  assert(html.includes('<title>'), `Missing title in ${file}`);
  for (const image of html.matchAll(/<img\b[^>]*>/g)) assert(/\balt="/.test(image[0]), `Missing image alternative in ${file}`);
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const reference = match[1].replaceAll('&amp;', '&');
    if (reference.startsWith('#')) {
      assert(ids.includes(reference.slice(1)), `Missing anchor ${reference} in ${file}`);
    } else if (reference.startsWith('/')) {
      const target = path.join(root, reference.endsWith('/') ? `${reference}index.html` : reference);
      assert(files.includes(target), `Missing local resource ${reference} in ${file}`);
    }
  }
  for (const match of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
    assert(/rel="[^"]*noopener/.test(match[0]), `Unsafe new-tab link in ${file}`);
  }
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(match[1]);
}
const css = await readFile(path.join(root, 'styles.css'), 'utf8');
for (const match of css.matchAll(/url\(['"]?(\/[^)'"\s]+)/g)) {
  assert(files.includes(path.join(root, match[1])), `Missing stylesheet resource ${match[1]}`);
}
const home = await readFile(path.join(root, 'index.html'), 'utf8');
assert(!/<video[^>]*\ssrc\s*=/.test(home), 'Video must not download until preferences are checked.');
assert(/<video[^>]*\bmuted\b/.test(home), 'Hero video must be muted.');
assert(/<video[^>]*\bplaysinline\b/.test(home), 'Hero video must play inline.');
for (const match of home.matchAll(/data-(?:desktop-src|mobile-src|opening-desktop|opening-mobile|colour-desktop|colour-mobile|fallback-src)="([^"]+)"/g)) {
  assert(files.includes(path.join(root, match[1])), `Missing media ${match[1]}`);
}
for (const file of files.filter((item) => item.endsWith('.js'))) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
const desktop = await stat(path.join(root, 'assets/finch-arrival-1280.mp4'));
const mobile = await stat(path.join(root, 'assets/finch-arrival-960.mp4'));
assert(desktop.size < 1_000_000, 'Desktop video exceeds 1 MB budget.');
assert(mobile.size < 600_000, 'Mobile video exceeds 600 KB budget.');
const fallback = await stat(path.join(root, 'assets/finch-arrival-fallback-800.webp'));
assert(fallback.size < 800_000, 'Animation fallback exceeds 800 KB budget.');
execFileSync(process.execPath, ['--test', 'scripts/test-intro.mjs'], { stdio: 'inherit' });
console.log(`Checked ${files.length} files: page structure, local links, media references, structured data, JavaScript syntax and video budgets.`);
