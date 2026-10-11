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
    const event = { type, target: this, ...detail };
    for (const entry of [...(this.listeners.get(type) || [])]) {
      if (entry.once) this.removeEventListener(type, entry.callback);
      entry.callback(event);
    }
    if (typeof this[`on${type}`] === 'function') this[`on${type}`](event);
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
  const imageLoads = [];
  const fetches = [];
  const activeURLs = new Set();
  const revokedURLs = new Set();
  const document = new Events();
  const root = element(html.match(/<html\b([^>]*)>/)[1]);
  const body = element(html.match(/<body\b([^>]*)>/)[1]);
  const elements = new Map();
  const ids = ['hero-video', 'hero-poster', 'hero-animation', 'hero-title', 'animation-skip', 'animation-status'];

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
    for (const property of ['src', 'srcset', 'preload', 'poster']) {
      Object.defineProperty(node, property, {
        get: () => attrs[property] || '',
        set(value) {
          attrs[property] = String(value);
          if (property !== 'src' || attrs.id !== 'hero-animation' || !value) return;
          node.complete = false;
          const deliver = (type, force = false) => {
            if (!force && node.src !== value) return;
            node.complete = true;
            node.naturalWidth = type === 'load' ? 800 : 0;
            node.emit(type);
          };
          imageLoads.push({ source: value, deliver });
          if (options.imageMode !== 'pending') {
            queueMicrotask(() => deliver(options.imageMode === 'reject' ? 'error' : 'load'));
          }
        },
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
    playCalls: 0, playMode: options.playMode || 'ready', playObservations: [],
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
    video.playObservations.push({
      visible: video.classList.contains('is-visible'), poster: video.poster,
      muted: video.muted, inline: video.playsInline,
    });
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
  class ImageURL extends URL {
    static createObjectURL(blob) {
      assert(blob instanceof Blob, 'The image URL must be backed by its downloaded blob.');
      const url = `blob:https://example.test/intro-${++sequence}`;
      activeURLs.add(url);
      return url;
    }
    static revokeObjectURL(url) {
      activeURLs.delete(url);
      revokedURLs.add(url);
    }
  }
  const window = Object.assign(new Events(), {
    document, navigator: { connection: { saveData: Boolean(options.saveData) } },
    console, URL: ImageURL, DOMException, Blob, AbortController, queueMicrotask,
    fetch(url, init = {}) {
      return new Promise((resolve, reject) => {
        const request = {
          url, signal: init.signal,
          resolve: () => resolve({ ok: true, blob: async () => new Blob(['animated image'], { type: 'image/webp' }) }),
          reject: () => reject(new TypeError('Image download failed')),
        };
        fetches.push(request);
        init.signal?.addEventListener('abort', () => {
          if (!options.fetchIgnoresAbort) reject(new DOMException('Download aborted', 'AbortError'));
        }, { once: true });
        if (options.fetchMode !== 'pending') queueMicrotask(options.fetchMode === 'reject' ? request.reject : request.resolve);
      });
    },
    performance: { now: () => now, getEntriesByType: () => [{ type: options.navigationType || 'navigate' }] },
    matchMedia(query) {
      if (!queries.has(query)) {
        const media = new Events();
        media.matches = query.split(',').some((part) => {
          if (part.includes('prefers-reduced-motion')) return Boolean(options.reducedMotion);
          if (part.includes('pointer:') && part.includes('coarse')) return Boolean(options.coarse);
          const maxWidth = part.match(/max-width:\s*(\d+)/)?.[1];
          return maxWidth ? (options.width || 390) <= Number(maxWidth) : false;
        });
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
  const initial = {
    colour: body.dataset.colour,
    posterSource: elements.get('hero-poster').src,
    posterSourceSet: elements.get('hero-poster').srcset,
  };
  vm.runInContext(bootstrap, context, { filename: 'index.html bootstrap' });

  return {
    root, body, video, document, fetches, activeURLs, revokedURLs, initial,
    animation: elements.get('hero-animation'),
    poster: elements.get('hero-poster'), title: elements.get('hero-title'), skip: elements.get('animation-skip'),
    start: () => vm.runInContext(main, context, { filename: 'public/main.js' }),
    async flush() { for (let turn = 0; turn < 18; turn += 1) await Promise.resolve(); },
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
    frame(milliseconds = 0) {
      this.advance(milliseconds);
      for (const [id, callback] of [...frames]) {
        if (!frames.delete(id)) continue;
        callback(now);
      }
    },
    imageReady(force = false) { imageLoads.at(-1)?.deliver('load', force); },
    seek(seconds) { video.currentTime = seconds; video.emit('timeupdate'); },
    visibility(visible) {
      document.hidden = !visible;
      document.visibilityState = visible ? 'visible' : 'hidden';
      document.emit('visibilitychange');
    },
    pageShow(persisted) { window.emit('pageshow', { persisted }); },
    pageHide(persisted = false) { window.emit('pagehide', { persisted }); },
    motionPreference(reduced) {
      for (const [query, media] of queries) {
        if (!query.includes('prefers-reduced-motion')) continue;
        media.matches = reduced;
        media.emit('change', { matches: reduced });
      }
    },
    end() { video.ended = true; video.paused = true; video.emit('ended'); },
  };
}

test('mobile arrival is monochrome before scripts run and starts its image without a video request', async () => {
  const view = page();
  assert.equal(view.initial.colour, 'mono');
  assert([view.poster.dataset.openingMobile, view.poster.dataset.openingDesktop].includes(view.initial.posterSource));
  assert.equal(view.initial.posterSourceSet, `${view.poster.dataset.openingMobile} 900w, ${view.poster.dataset.openingDesktop} 1600w`);
  assert.equal(view.root.dataset.introPending, 'true');
  assert.equal(view.video.src, '');
  view.advance(6000);
  assert.equal(view.root.dataset.introPending, 'true', 'A slow script must not expose colour before the opening.');
  view.start();
  assert.equal(view.body.dataset.colour, 'mono');
  assert.equal(view.video.src, '');
  assert.equal(view.video.playCalls, 0);
  assert.equal(view.poster.src, view.poster.dataset.openingMobile);
  await view.flush();
  assert.match(view.animation.src, /^blob:/);
  assert.equal(view.animation.hidden, false);
  assert.equal(view.fetches.length, 1);
  assert.equal(view.fetches[0].url, view.animation.dataset.fallbackSrc);
  assert.equal(view.skip.hidden, false);
  assert.equal(view.video.playCalls, 0);
});

test('a landscape phone uses the image arrival even above the narrow-screen breakpoint', async () => {
  const view = page({ width: 960, coarse: true });
  view.start();
  await view.flush();
  assert.equal(view.video.playCalls, 0);
  assert.equal(view.video.src, '');
  assert.match(view.animation.src, /^blob:/);
  assert.equal(view.body.dataset.colour, 'mono');
});

test('reloads, old seen flags and restored pages still receive a fresh introduction', async () => {
  for (const width of [390, 1440]) {
    for (const navigationType of ['navigate', 'reload']) {
      const view = page({ seen: true, navigationType, width });
      assert.equal(view.root.dataset.introPending, 'true');
      view.start();
      await view.flush();
      assert.equal(view.body.dataset.colour, 'mono');
      const firstImage = view.animation.src;
      const firstVideoRequests = view.video.playCalls;
      view.pageShow(false);
      await view.flush();
      assert.equal(view.animation.src, firstImage, 'Initial pageshow must not restart the image.');
      assert.equal(view.video.playCalls, firstVideoRequests, 'Initial pageshow must not restart the video.');
      if (width === 390) view.frame(Number(view.animation.dataset.durationMs));
      else { view.seek(8); view.end(); }
      assert.equal(view.body.dataset.colour, 'colour');
      view.pageHide(true);
      assert.equal(view.body.dataset.colour, 'mono', 'The cached page snapshot must already contain the opening state.');
      assert.equal(view.body.dataset.intro, 'waiting');
      assert.equal(view.poster.src, width === 390 ? view.poster.dataset.openingMobile : view.poster.dataset.openingDesktop);
      assert.equal(view.animation.src, '');
      assert.equal(view.activeURLs.size, 0);
      view.pageShow(true);
      await view.flush();
      assert.equal(view.body.dataset.colour, 'mono');
      assert.equal(view.body.dataset.intro, 'playing');
      if (width === 390) {
        assert.notEqual(view.animation.src, firstImage);
        assert.match(view.animation.src, /^blob:/);
        assert.equal(view.video.playCalls, 0);
      } else {
        assert.equal(view.video.playCalls, 2);
        assert.equal(view.video.currentTime, 0);
      }
    }
  }
});

test('unavailable session storage cannot change first paint or prevent playback', async () => {
  const view = page({ storageBlocked: true });
  assert.equal(view.root.dataset.introPending, 'true');
  view.start();
  await view.flush();
  assert.equal(view.body.dataset.colour, 'mono');
  assert.match(view.animation.src, /^blob:/);
  assert.equal(view.video.playCalls, 0);
});

test('desktop arrival selects its desktop artwork and video', async () => {
  const view = page({ width: 1440 });
  view.start();
  assert.equal(view.video.hasAttribute('autoplay'), true);
  assert.deepEqual(view.video.playObservations[0], {
    visible: true, poster: view.poster.dataset.openingDesktop, muted: true, inline: true,
  }, 'The video must already be visible with its opening poster when playback is requested.');
  await view.flush();
  assert.equal(view.video.src, view.video.dataset.desktopSrc);
  assert.equal(view.poster.src, view.poster.dataset.openingDesktop);
  assert.equal(view.video.playCalls, 1);
});

test('motion and data settings do not silently skip the explicitly required arrival', async () => {
  for (const width of [390, 1440]) {
    for (const preference of [{ reducedMotion: true }, { saveData: true }, { reducedMotion: true, saveData: true }]) {
      const view = page({ width, ...preference });
      assert.equal(view.initial.colour, 'mono');
      assert.equal(view.root.dataset.introPending, 'true');
      view.start();
      await view.flush();
      assert.equal(view.body.dataset.colour, 'mono');
      assert.equal(view.body.dataset.intro, 'playing');
      if (width === 390) {
        assert.equal(view.video.playCalls, 0);
        assert.match(view.animation.src, /^blob:/);
      } else {
        assert.equal(view.video.paused, false);
        assert.equal(view.video.playCalls, 1);
      }
      view.motionPreference(false);
      view.motionPreference(true);
      assert.equal(view.body.dataset.intro, 'playing');
      assert.equal(view.body.dataset.colour, 'mono');
    }
  }
});

test('colour follows the landing cue and the completed film resolves to its still', async () => {
  const view = page({ width: 1440 });
  view.start();
  await view.flush();
  view.seek(3.39);
  assert.equal(view.body.dataset.colour, 'mono');
  view.seek(3.4);
  assert.equal(view.body.dataset.colour, 'colour');
  const readingFocus = {};
  view.document.activeElement = readingFocus;
  view.end();
  assert.equal(view.body.dataset.intro, 'finished');
  assert.equal(view.video.classList.contains('is-visible'), false);
  assert.equal(view.poster.src, view.poster.dataset.colourDesktop);
  assert.equal(view.document.activeElement, readingFocus, 'Completion must not move focus away from the visitor.');
});

test('Skip releases either renderer, moves focus to the heading, and refresh starts again', async () => {
  for (const width of [390, 1440]) {
    const view = page({ width });
    view.start();
    await view.flush();
    if (width === 390) view.frame(2000); else view.seek(2);
    view.skip.focus();
    view.skip.click();
    await view.flush();
    assert.equal(view.body.dataset.colour, 'colour');
    assert.equal(view.video.src, '');
    assert.equal(view.animation.src, '');
    assert.equal(view.activeURLs.size, 0);
    assert.equal(view.skip.hidden, true);
    assert.equal(view.document.activeElement, view.title);
    assert.equal(view.title.getAttribute('tabindex'), '-1');
    const refreshed = page({ width, navigationType: 'reload' });
    refreshed.start();
    await refreshed.flush();
    assert.equal(refreshed.body.dataset.colour, 'mono');
    assert.equal(refreshed.body.dataset.intro, 'playing');
    assert.equal(refreshed.skip.hidden, false);
    if (width === 390) assert.match(refreshed.animation.src, /^blob:/);
    else assert.equal(refreshed.video.paused, false);
  }
});

test('only Skip is rendered and absent Play controls cannot prevent automatic startup', async () => {
  const controls = html.match(/<div class="animation-controls">([\s\S]*?)<\/div>/)?.[1];
  assert(controls, 'The introduction must retain its Skip control.');
  const labels = [...controls.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)]
    .map((match) => match[1].replace(/<[^>]*>/g, '').trim());
  assert.deepEqual(labels, ['Skip animation']);
  assert(!/\bid="(?:animation-toggle|animation-label)"/.test(html));
  for (const width of [390, 1440]) {
    const view = page({ width });
    assert.equal(view.document.getElementById('animation-toggle'), null);
    assert.equal(view.document.getElementById('animation-label'), null);
    assert.equal(view.video.hasAttribute('controls'), false);
    view.start();
    await view.flush();
    assert.equal(view.body.dataset.intro, 'playing');
    assert.equal(view.body.dataset.colour, 'mono');
    assert.equal(view.skip.hidden, false);
  }
});

test('autoplay denial runs the same arrival as an image with honest controls and a colour cue', async () => {
  const view = page({ width: 1440, playMode: 'reject' });
  view.start();
  await view.flush();
  assert.equal(view.body.dataset.colour, 'mono');
  assert.equal(view.body.dataset.intro, 'playing');
  assert.equal(view.video.src, '');
  assert.match(view.animation.src, /^blob:/);
  assert.equal(view.animation.hidden, false);
  assert.equal(view.skip.hidden, false);
  assert.equal(view.fetches[0].url, view.animation.dataset.fallbackSrc);
  view.frame(3399);
  assert.equal(view.body.dataset.colour, 'mono');
  view.frame(1);
  assert.equal(view.body.dataset.colour, 'colour');
  view.skip.focus();
  view.frame(Number(view.animation.dataset.durationMs) - 3400);
  assert.equal(view.body.dataset.intro, 'finished');
  assert.equal(view.skip.hidden, true);
  assert.equal(view.animation.src, '');
  assert.equal(view.activeURLs.size, 0);
  assert.equal(view.document.activeElement, view.title, 'A disappearing focused Skip control must return focus to the heading.');
});

test('a film that never loads or stalls starts the image fallback instead of skipping the arrival', async () => {
  for (const playMode of ['pending', 'ready']) {
    const view = page({ width: 1440, playMode });
    view.start();
    await view.flush();
    if (playMode === 'ready') view.video.emit('waiting');
    // Let network/image microtasks run between deadlines, as the browser does.
    // The introduction must find a working alternative within this bound.
    for (let elapsed = 0; elapsed < 30000 && !view.animation.src; elapsed += 1000) {
      view.advance(1000);
      await view.flush();
    }
    assert.equal(view.body.dataset.colour, 'mono');
    assert.equal(view.body.dataset.intro, 'playing');
    assert.equal(view.video.src, '');
    assert.match(view.animation.src, /^blob:/);
    view.frame(Number(view.animation.dataset.durationMs));
    assert.equal(view.body.dataset.colour, 'colour');
    assert.equal(view.body.dataset.intro, 'finished');
  }
});

test('a document opened in the background waits until it becomes visible', async () => {
  const view = page({ hidden: true });
  view.start();
  await view.flush();
  view.advance(30000);
  assert.equal(view.video.playCalls, 0);
  assert.equal(view.video.paused, true);
  assert.equal(view.fetches.length, 0);
  assert.equal(view.body.dataset.colour, 'mono');
  view.visibility(true);
  await view.flush();
  assert.equal(view.video.playCalls, 0);
  assert.match(view.animation.src, /^blob:/);
  assert.equal(view.fetches.length, 1);
  assert.equal(view.body.dataset.colour, 'mono');
  assert.equal(view.video.currentTime, 0);
});

test('automatic background suspension resumes at the same place without restarting', async () => {
  const view = page({ width: 1440 });
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

test('unexpected native pause or error switches to the image and ignores stale video events', async () => {
  for (const failure of ['pause', 'error']) {
    const view = page({ width: 1440, playMode: failure === 'pause' ? 'pending' : 'ready' });
    view.start();
    await view.flush();
    if (failure === 'pause') view.video.pause();
    else { view.video.error = { code: 3 }; view.video.emit('error'); }
    await view.flush();
    assert.match(view.animation.src, /^blob:/);
    assert.equal(view.body.dataset.colour, 'mono');
    const source = view.animation.src;
    view.video.currentTime = 9;
    for (const event of ['playing', 'timeupdate', 'waiting', 'ended', 'error', 'pause']) view.video.emit(event);
    await view.flush();
    assert.equal(view.animation.src, source);
    assert.equal(view.body.dataset.intro, 'playing');
    assert.equal(view.body.dataset.colour, 'mono');
    assert.equal(view.fetches.length, 1);
    view.frame(Number(view.animation.dataset.durationMs));
    assert.equal(view.body.dataset.intro, 'finished');
  }
});

test('an actual image failure leaves a usable colour page and a refresh can try again', async () => {
  for (const failure of [{ fetchMode: 'reject' }, { imageMode: 'reject' }]) {
    const view = page({ width: 1440, playMode: 'reject', ...failure });
    view.start();
    await view.flush();
    assert.equal(view.body.dataset.intro, 'finished');
    assert.equal(view.body.dataset.colour, 'colour');
    assert.equal(view.skip.hidden, true);
    assert.equal(view.activeURLs.size, 0);
    const refreshed = page({ width: 1440, navigationType: 'reload' });
    refreshed.start();
    await refreshed.flush();
    assert.equal(refreshed.video.paused, false);
    assert.equal(refreshed.body.dataset.colour, 'mono');
  }
});

test('Skip or page departure cancels pending image work and late completion cannot revive it', async () => {
  for (const pending of ['fetch', 'image']) {
    for (const leave of ['skip', 'pagehide']) {
      const view = page({
        playMode: 'reject', fetchMode: pending === 'fetch' ? 'pending' : 'ready',
        fetchIgnoresAbort: true, imageMode: pending === 'image' ? 'pending' : 'ready',
      });
      view.start();
      await view.flush();
      if (leave === 'skip') view.skip.click(); else view.pageHide();
      if (pending === 'fetch') {
        assert.equal(view.fetches[0].signal.aborted, true);
        view.fetches[0].resolve();
      } else view.imageReady(true);
      await view.flush();
      view.frame(20000);
      assert.equal(view.body.dataset.intro, leave === 'skip' ? 'finished' : 'waiting');
      assert.equal(view.body.dataset.colour, leave === 'skip' ? 'colour' : 'mono');
      assert.equal(view.animation.src, '');
      assert.equal(view.activeURLs.size, 0);
      assert.equal(view.skip.hidden, leave === 'skip');
    }
  }
});

test('a restored arrival reuses the downloaded film with a fresh, cleaned-up image URL', async () => {
  const view = page();
  view.start();
  await view.flush();
  const firstURL = view.animation.src;
  view.frame(Number(view.animation.dataset.durationMs));
  assert.equal(view.revokedURLs.has(firstURL), true);
  view.pageHide(true);
  view.pageShow(true);
  await view.flush();
  assert.notEqual(view.animation.src, firstURL);
  assert.match(view.animation.src, /^blob:/);
  assert.equal(view.activeURLs.size, 1);
  assert.equal(view.fetches.length, 1);
  assert.equal(view.video.playCalls, 0);
  assert.equal(view.body.dataset.colour, 'mono');
  view.frame(3399);
  assert.equal(view.body.dataset.colour, 'mono');
  view.skip.click();
  assert.equal(view.activeURLs.size, 0);
});

test('an image arrival clears while hidden and restarts from its beginning when visible', async () => {
  const view = page();
  view.start();
  await view.flush();
  const firstURL = view.animation.src;
  view.frame(4000);
  view.visibility(false);
  await view.flush();
  assert.equal(view.animation.src, '');
  assert.equal(view.activeURLs.size, 0);
  view.advance(30000);
  view.visibility(true);
  await view.flush();
  assert.match(view.animation.src, /^blob:/);
  assert.notEqual(view.animation.src, firstURL);
  assert.equal(view.body.dataset.colour, 'mono');
  assert.equal(view.fetches.length, 1);
  view.frame(3399);
  assert.equal(view.body.dataset.colour, 'mono');
  view.frame(1);
  assert.equal(view.body.dataset.colour, 'colour');
});

test('returning after a completed introduction automatically starts a fresh arrival', async () => {
  for (const width of [390, 1440]) {
    const view = page({ width });
    view.start();
    await view.flush();
    const firstImage = view.animation.src;
    if (width === 390) view.frame(Number(view.animation.dataset.durationMs));
    else { view.seek(8); view.end(); }
    assert.equal(view.body.dataset.intro, 'finished');
    assert.equal(view.body.dataset.colour, 'colour');
    view.visibility(false);
    assert.equal(view.body.dataset.colour, 'mono');
    view.advance(30000);
    view.visibility(true);
    await view.flush();
    assert.equal(view.body.dataset.colour, 'mono');
    assert.equal(view.body.dataset.intro, 'playing');
    if (width === 390) {
      assert.match(view.animation.src, /^blob:/);
      assert.notEqual(view.animation.src, firstImage);
      assert.equal(view.video.playCalls, 0);
      assert.equal(view.fetches.length, 1);
    } else {
      assert.equal(view.video.paused, false);
      assert.equal(view.video.currentTime, 0);
      assert.equal(view.video.playCalls, 2);
    }
  }
});

test('a late image download or load remains monochrome and starts when ready without a manual Play', async () => {
  for (const pending of ['fetch', 'image']) {
    const view = page({
      fetchMode: pending === 'fetch' ? 'pending' : 'ready',
      imageMode: pending === 'image' ? 'pending' : 'ready',
    });
    view.start();
    await view.flush();
    view.advance(30000);
    await view.flush();
    assert.equal(view.body.dataset.colour, 'mono');
    assert.equal(view.body.dataset.intro, 'playing');
    assert.equal(view.skip.hidden, false);
    assert.equal(view.fetches[0].signal.aborted, false);
    if (pending === 'fetch') view.fetches[0].resolve(); else view.imageReady();
    await view.flush();
    assert.match(view.animation.src, /^blob:/);
    assert.equal(view.animation.hidden, false);
    assert.equal(view.video.playCalls, 0);
    assert.equal(view.body.dataset.colour, 'mono');
    view.frame(3400);
    assert.equal(view.body.dataset.colour, 'colour');
  }
});
