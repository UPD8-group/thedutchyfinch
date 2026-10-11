import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../public/main.js', import.meta.url), 'utf8');
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(bootstrap, 'The document must contain its first-paint bootstrap.');

// These tests execute the shipped scripts. The harness only models DOM events,
// media outcomes and a controllable clock; it does not simulate a browser's
// rendering or guarantee that a particular device permits muted autoplay.
class Events {
  listeners = new Map();
  addEventListener(type, callback, options = {}) {
    const entries = this.listeners.get(type) || [];
    entries.push({ callback, once: options?.once });
    this.listeners.set(type, entries);
  }
  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry.callback !== callback));
  }
  emit(type, detail = {}) {
    for (const entry of [...(this.listeners.get(type) || [])]) {
      if (entry.once) this.removeEventListener(type, entry.callback);
      entry.callback({ type, target: this, ...detail });
    }
  }
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((match) => [match[1], match[2] ?? '']));
}

function page(options = {}) {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  const frames = new Map();
  const document = new Events();
  const root = element(html.match(/<html\b([^>]*)>/)[1]);
  const body = element(html.match(/<body\b([^>]*)>/)[1]);
  const elements = new Map();
  const ids = ['hero-video', 'hero-poster', 'animation-toggle', 'animation-label', 'animation-skip', 'animation-status'];

  function element(tag) {
    const attrs = attributes(tag);
    const node = new Events();
    const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    node.dataset = Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-'))
      .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
    node.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        const present = force ?? !classes.has(name);
        if (present) classes.add(name); else classes.delete(name);
        return present;
      },
    };
    node.getAttribute = (name) => attrs[name] ?? null;
    node.setAttribute = (name, value) => { attrs[name] = String(value); };
    node.removeAttribute = (name) => { delete attrs[name]; };
    node.hasAttribute = (name) => Object.hasOwn(attrs, name);
    node.hidden = Object.hasOwn(attrs, 'hidden');
    node.complete = true;
    node.naturalWidth = 1600;
    node.textContent = '';
    node.style = {};
    node.focus = () => { document.activeElement = node; };
    node.click = () => node.emit('click');
    for (const property of ['src', 'srcset', 'preload']) {
      Object.defineProperty(node, property, {
        get: () => attrs[property] || '',
        set: (value) => { attrs[property] = String(value); },
      });
    }
    return node;
  }

  for (const id of ids) {
    const tag = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0];
    assert(tag, `Missing introduction element ${id}.`);
    elements.set(id, element(tag));
  }
  Object.assign(document, {
    body, documentElement: root, readyState: 'complete', activeElement: null,
    hidden: Boolean(options.hidden), visibilityState: options.hidden ? 'hidden' : 'visible',
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
  });

  const video = elements.get('hero-video');
  Object.assign(video, {
    paused: true, ended: false, currentTime: 0, readyState: 0,
    playCalls: 0, playMode: options.playMode || 'ready',
  });
  video.pause = () => {
    const wasPlaying = !video.paused;
    video.paused = true;
    if (wasPlaying) queueMicrotask(() => video.emit('pause'));
  };
  video.load = () => {
    video.pause();
    video.currentTime = 0;
    video.ended = false;
  };
  video.play = () => {
    video.playCalls += 1;
    if (video.playMode === 'reject') return Promise.reject(new DOMException('Autoplay denied', 'NotAllowedError'));
    video.paused = false;
    if (video.playMode === 'pending') return new Promise(() => {});
    return new Promise((resolve, reject) => queueMicrotask(() => {
      if (video.paused || !video.src) {
        reject(new DOMException('Playback interrupted', 'AbortError'));
      } else {
        video.readyState = 4;
        video.emit('playing');
        resolve();
      }
    }));
  };

  const queries = new Map();
  const storage = new Map(options.seen ? [['dutchy-finch-intro-v1', 'seen']] : []);
  const window = Object.assign(new Events(), {
    document, navigator: { connection: { saveData: Boolean(options.saveData) } },
    console, URL, DOMException, queueMicrotask,
    performance: { now: () => now, getEntriesByType: () => [{ type: options.navigationType || 'navigate' }] },
    matchMedia(query) {
      if (!queries.has(query)) {
        const media = new Events();
        media.matches = query.includes('prefers-reduced-motion') ? Boolean(options.reducedMotion)
          : (options.width || 390) <= Number(query.match(/max-width:\s*(\d+)/)?.[1] || 700);
        media.addListener = (callback) => media.addEventListener('change', callback);
        queries.set(query, media);
      }
      return queries.get(query);
    },
    setTimeout(callback, delay = 0) {
      const id = ++sequence;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame(callback) {
      const id = ++sequence;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  Object.defineProperty(window, 'sessionStorage', {
    get() {
      if (options.storageBlocked) throw new DOMException('Storage unavailable', 'SecurityError');
      return { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
    },
  });
  window.window = window;
  const context = vm.createContext(window);
  vm.runInContext(bootstrap, context, { filename: 'index.html bootstrap' });

  return {
    root, body, video, document,
    poster: elements.get('hero-poster'), toggle: elements.get('animation-toggle'), skip: elements.get('animation-skip'),
    start: () => vm.runInContext(main, context, { filename: 'public/main.js' }),
    async flush() { for (let turn = 0; turn < 6; turn += 1) await Promise.resolve(); },
    advance(milliseconds) {
      const target = now + milliseconds;
      for (let count = 0; count < 100; count += 1) {
        const next = [...timers].sort((a, b) => a[1].due - b[1].due).find(([, timer]) => timer.due <= target);
        if (!next) { now = target; return; }
        now = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
      }
      assert.fail('Unbounded introduction timer scheduling.');
    },
    seek(seconds) { video.currentTime = seconds; video.emit('timeupdate'); },
    visibility(visible) {
      document.hidden = !visible;
      document.visibilityState = visible ? 'visible' : 'hidden';
      document.emit('visibilitychange');
    },
    pageShow(persisted) { window.emit('pageshow', { persisted }); },
    end() { video.ended = true; video.paused = true; video.emit('ended'); },
  };
}

test('mobile arrival prepares monochrome before its first playback frame', async () => {
  const view = page();
  assert.equal(view.root.dataset.introPending, 'true');
  assert.equal(view.video.src, '');
  view.advance(6000);
  assert.equal(view.root.dataset.introPending, 'true', 'A slow script must not expose colour before the opening.');
  view.start();
  assert.equal(view.body.dataset.colour, 'mono');
  assert.equal(view.video.src, view.video.dataset.mobileSrc);
  assert.equal(view.poster.src, view.poster.dataset.openingMobile);
  await view.flush();
  assert.equal(view.video.playCalls, 1);
  assert.equal(view.video.paused, false);
  assert.equal(view.video.muted, true);
  assert.equal(view.video.playsInline, true);
  assert.equal(view.video.classList.contains('is-visible'), true);
});

test('reloads, old seen flags and restored pages still receive a fresh introduction', async () => {
  for (const navigationType of ['navigate', 'reload']) {
    const view = page({ seen: true, navigationType });
    assert.equal(view.root.dataset.introPending, 'true');
    view.start();
    await view.flush();
    assert.equal(view.body.dataset.colour, 'mono');
    assert.equal(view.video.playCalls, 1);
    assert.equal(view.video.paused, false);
    view.pageShow(false);
    await view.flush();
    assert.equal(view.video.playCalls, 1, 'Initial pageshow must not start a duplicate film.');
    view.seek(8);
    view.end();
    view.pageShow(true);
    await view.flush();
    assert.equal(view.video.playCalls, 2);
    assert.equal(view.video.currentTime, 0);
    assert.equal(view.body.dataset.colour, 'mono');
  }
});

test('unavailable session storage cannot change first paint or prevent playback', async () => {
  const view = page({ storageBlocked: true });
  assert.equal(view.root.dataset.introPending, 'true');
  view.start();
  await view.flush();
  assert.equal(view.body.dataset.colour, 'mono');
  assert.equal(view.video.paused, false);
});

test('desktop arrival selects its desktop artwork and video', async () => {
  const view = page({ width: 1440 });
  view.start();
  await view.flush();
  assert.equal(view.video.src, view.video.dataset.desktopSrc);
  assert.equal(view.poster.src, view.poster.dataset.openingDesktop);
  assert.equal(view.video.playCalls, 1);
});

test('motion and data preferences show colour without an automatic video request', async () => {
  for (const preference of [{ reducedMotion: true }, { saveData: true }]) {
    const view = page(preference);
    assert.notEqual(view.root.dataset.introPending, 'true');
    view.start();
    await view.flush();
    assert.equal(view.video.src, '');
    assert.equal(view.video.playCalls, 0);
    assert.equal(view.body.dataset.colour, 'colour');
    assert.equal(view.poster.src, view.poster.dataset.colourMobile);
  }
});

test('colour follows the landing cue and the completed film resolves to its still', async () => {
  const view = page();
  view.start();
  await view.flush();
  view.seek(3.39);
  assert.equal(view.body.dataset.colour, 'mono');
  view.seek(3.4);
  assert.equal(view.body.dataset.colour, 'colour');
  view.end();
  assert.equal(view.body.dataset.intro, 'finished');
  assert.equal(view.video.classList.contains('is-visible'), false);
  assert.equal(view.poster.src, view.poster.dataset.colourMobile);
});

test('Skip releases the film, restores focus and Replay restarts from monochrome', async () => {
  const view = page();
  view.start();
  await view.flush();
  view.seek(2);
  view.skip.focus();
  view.skip.click();
  await view.flush();
  assert.equal(view.body.dataset.colour, 'colour');
  assert.equal(view.video.src, '');
  assert.equal(view.skip.hidden, true);
  assert.equal(view.document.activeElement, view.toggle);
  view.toggle.click();
  await view.flush();
  assert.equal(view.body.dataset.colour, 'mono');
  assert.equal(view.video.currentTime, 0);
  assert.equal(view.video.paused, false);
  assert.equal(view.skip.hidden, false);
});

test('an explicit Pause survives backgrounding and only resumes when requested', async () => {
  const view = page();
  view.start();
  await view.flush();
  view.seek(1.5);
  view.toggle.click();
  await view.flush();
  const requests = view.video.playCalls;
  view.visibility(false);
  view.advance(30000);
  view.visibility(true);
  await view.flush();
  assert.equal(view.video.playCalls, requests);
  assert.equal(view.video.paused, true);
  assert.equal(view.body.dataset.intro, 'paused');
  view.toggle.click();
  await view.flush();
  assert.equal(view.video.paused, false);
  assert.equal(view.video.currentTime, 1.5);
});

test('autoplay denial leaves a usable colour page and a working manual replay', async () => {
  const view = page({ playMode: 'reject' });
  view.start();
  await view.flush();
  assert.equal(view.body.dataset.colour, 'colour');
  assert.equal(view.body.dataset.intro, 'finished');
  assert.equal(view.video.src, '');
  assert.equal(view.skip.hidden, true);
  view.video.playMode = 'ready';
  view.toggle.click();
  await view.flush();
  assert.equal(view.body.dataset.colour, 'mono');
  assert.equal(view.video.paused, false);
});

test('a film that never loads or stalls cannot leave the page monochrome indefinitely', async () => {
  for (const playMode of ['pending', 'ready']) {
    const view = page({ playMode });
    view.start();
    await view.flush();
    if (playMode === 'ready') view.video.emit('waiting');
    view.advance(30000);
    await view.flush();
    assert.equal(view.body.dataset.colour, 'colour');
    assert.equal(view.body.dataset.intro, 'finished');
    assert.equal(view.video.src, '');
  }
});

test('a document opened in the background waits until it becomes visible', async () => {
  const view = page({ hidden: true });
  view.start();
  await view.flush();
  view.advance(30000);
  assert.equal(view.video.playCalls, 0);
  assert.equal(view.video.paused, true);
  view.visibility(true);
  await view.flush();
  assert.equal(view.video.playCalls, 1);
  assert.equal(view.video.paused, false);
  assert.equal(view.body.dataset.colour, 'mono');
  assert.equal(view.video.currentTime, 0);
});

test('automatic background suspension resumes at the same place without restarting', async () => {
  const view = page();
  view.start();
  await view.flush();
  view.seek(1.5);
  view.visibility(false);
  await view.flush();
  assert.equal(view.video.paused, true);
  view.advance(30000);
  view.visibility(true);
  await view.flush();
  assert.equal(view.video.paused, false);
  assert.equal(view.video.currentTime, 1.5);
  assert.equal(view.body.dataset.colour, 'mono');
});
