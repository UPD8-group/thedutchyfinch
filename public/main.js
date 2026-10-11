/* The Dutchy Finch: a quiet introduction, with every interaction optional. */
(() => {
  'use strict';

  function initialiseNavigation() {
    const toggle = document.getElementById('menu-toggle');
    const navigation = document.getElementById('site-nav');
    const header = document.querySelector('[data-header]');

    if (toggle && navigation) {
      const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
      const setOpen = (open, returnFocus = false) => {
        toggle.setAttribute('aria-expanded', String(open));
        navigation.classList.toggle('is-open', open);
        document.body.classList.toggle('menu-open', open);
        if (returnFocus) toggle.focus({ preventScroll: true });
      };

      toggle.addEventListener('click', () => setOpen(!isOpen()));
      navigation.addEventListener('click', (event) => {
        if (event.target.closest('a[href]')) setOpen(false);
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isOpen()) {
          setOpen(false, true);
        }
      });
      document.addEventListener('click', (event) => {
        if (isOpen() && !navigation.contains(event.target) && !toggle.contains(event.target)) {
          setOpen(false);
        }
      });
      window.addEventListener('resize', () => {
        // Follow the stylesheet's breakpoint, so navigation cannot stay hidden
        // or keep a mobile scroll lock after rotating/resizing the screen.
        if (isOpen() && window.getComputedStyle(toggle).display === 'none') {
          setOpen(false);
        }
      }, { passive: true });
    }

    if (header) {
      let scheduled = false;
      const updateHeader = () => {
        header.classList.toggle('is-scrolled', window.scrollY > 24);
        scheduled = false;
      };
      window.addEventListener('scroll', () => {
        if (!scheduled) {
          scheduled = true;
          window.requestAnimationFrame(updateHeader);
        }
      }, { passive: true });
      updateHeader();
    }
  }

  function initialiseIntroduction() {
    const video = document.getElementById('hero-video');
    const poster = document.getElementById('hero-poster');
    const toggle = document.getElementById('animation-toggle');
    const label = document.getElementById('animation-label');
    const skip = document.getElementById('animation-skip');
    const status = document.getElementById('animation-status');
    const body = document.body;
    const root = document.documentElement;

    if (!video || !poster || !toggle || !label) {
      body.dataset.intro = 'finished';
      body.dataset.colour = 'colour';
      delete root.dataset.introPending;
      return;
    }

    const COLOUR_CUE = 3.4;
    const LOAD_TIMEOUT = 12000;
    const narrowScreen = window.matchMedia('(max-width: 700px)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    // Pick one video asset. Resizing never silently downloads the other version.
    const videoSource = narrowScreen.matches
      ? video.dataset.mobileSrc || video.dataset.desktopSrc
      : video.dataset.desktopSrc || video.dataset.mobileSrc;

    let state = 'finished';
    let colour = 'colour';
    let sourceAssigned = false;
    let operation = 0;
    let timeout = 0;
    let animationFrame = 0;
    let awaitingArrival = false;
    let resumeWhenVisible = false;

    const allowsAutoplay = () => !reducedMotion.matches && !(connection && connection.saveData);

    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = false;

    function announce(message) {
      if (status) status.textContent = message;
    }

    function revealPoster() {
      delete root.dataset.introPending;
    }

    function updatePoster() {
      const opening = colour === 'mono';
      const desktop = opening ? poster.dataset.openingDesktop : poster.dataset.colourDesktop;
      const mobile = opening ? poster.dataset.openingMobile : poster.dataset.colourMobile;
      const source = narrowScreen.matches ? mobile || desktop : desktop || mobile;
      if (source) {
        // Update srcset too: otherwise the browser may keep the colour image
        // while the introduction is supposed to show the empty branch.
        if (desktop && mobile) poster.srcset = `${mobile} 900w, ${desktop} 1600w`;
        else poster.removeAttribute('srcset');
        poster.src = source;
      }
      if (poster.complete) revealPoster();
      else {
        poster.addEventListener('load', revealPoster, { once: true });
        poster.addEventListener('error', revealPoster, { once: true });
      }
    }

    function setColour(nextColour) {
      colour = nextColour;
      body.dataset.colour = nextColour;
      updatePoster();
    }

    function setState(nextState) {
      state = nextState;
      body.dataset.intro = nextState;
      const action = nextState === 'playing' ? 'Pause animation'
        : nextState === 'paused' ? 'Resume animation'
        : nextState === 'waiting' ? 'Play animation' : 'Replay animation';
      label.textContent = action;
      toggle.setAttribute('aria-label', action);
      if (skip) skip.hidden = !['playing', 'paused', 'waiting'].includes(nextState);
    }

    function clearTimers() {
      window.clearTimeout(timeout);
      window.cancelAnimationFrame(animationFrame);
      timeout = 0;
      animationFrame = 0;
    }

    function finish(message = '', releaseSource = false) {
      operation += 1;
      awaitingArrival = false;
      resumeWhenVisible = false;
      clearTimers();
      const skipHadFocus = skip && document.activeElement === skip;
      setState('finished');
      video.pause();
      video.classList.remove('is-visible');
      setColour('colour');
      // Skipping, preference changes and failures also stop a pending download.
      if (releaseSource && sourceAssigned) {
        video.removeAttribute('src');
        video.preload = 'none';
        sourceAssigned = false;
        video.load();
      }
      if (message) announce(message);
      if (skipHadFocus) toggle.focus({ preventScroll: true });
    }

    function armTimeout() {
      window.clearTimeout(timeout);
      const currentOperation = operation;
      timeout = window.setTimeout(() => {
        if (currentOperation === operation && state === 'playing') {
          finish('The full-colour website is ready. You can try the animation again.', true);
        }
      }, LOAD_TIMEOUT);
    }

    function checkColourCue() {
      if (state === 'playing' && video.currentTime >= COLOUR_CUE && colour !== 'colour') {
        setColour('colour');
      }
    }

    function followPlayback() {
      checkColourCue();
      if (state === 'playing') animationFrame = window.requestAnimationFrame(followPlayback);
    }

    function requestPlayback() {
      const currentOperation = ++operation;
      setState('playing');
      armTimeout();
      try {
        const playRequest = video.play();
        if (playRequest && typeof playRequest.catch === 'function') {
          playRequest.catch(() => {
            // Ignore promises cancelled by the visitor pausing or skipping.
            if (currentOperation === operation && state === 'playing') {
              finish('The full-colour website is ready. Select replay to watch the animation.', true);
            }
          });
        }
      } catch (_) {
        if (currentOperation === operation) {
          finish('The full-colour website is ready. Select replay to watch the animation.', true);
        }
      }
    }

    function start() {
      operation += 1;
      awaitingArrival = false;
      resumeWhenVisible = false;
      clearTimers();
      video.pause();
      video.classList.remove('is-visible');

      if (!videoSource) {
        finish('The full-colour website is ready.');
        return;
      }

      setColour('mono');
      announce('The finch is arriving. You can pause or skip the animation.');
      if (!sourceAssigned) {
        video.preload = 'auto';
        video.src = videoSource;
        sourceAssigned = true;
        video.load();
      } else {
        try {
          video.currentTime = 0;
        } catch (_) {
          // Seeking before metadata arrives is unnecessary for a fresh source.
        }
      }
      requestPlayback();
    }

    function pause(forVisibility = false) {
      operation += 1;
      resumeWhenVisible = forVisibility;
      clearTimers();
      setState('paused');
      video.pause();
      announce('Animation paused.');
    }

    toggle.addEventListener('click', () => {
      if (state === 'playing') pause();
      else if (state === 'paused') {
        resumeWhenVisible = false;
        announce('Animation resumed.');
        requestPlayback();
      } else start();
    });

    if (skip) {
      skip.addEventListener('click', () => {
        finish('Animation skipped. The website is now in colour.', true);
        // The skip button disappears; preserve a useful keyboard focus target.
        toggle.focus({ preventScroll: true });
      });
    }

    video.addEventListener('playing', () => {
      if (state !== 'playing') {
        video.pause();
        return;
      }
      window.clearTimeout(timeout);
      video.classList.add('is-visible');
      window.cancelAnimationFrame(animationFrame);
      followPlayback();
    });
    video.addEventListener('timeupdate', checkColourCue);
    video.addEventListener('pause', () => {
      // Keep the controls honest if the browser or device interrupts playback.
      // Our own pause/finish actions already update state before pausing video.
      if (state === 'playing' && video.paused && !video.ended) pause(document.hidden);
    });
    video.addEventListener('waiting', () => {
      if (state === 'playing') armTimeout();
    });
    video.addEventListener('ended', () => {
      if (state === 'playing') finish('The finch has landed. The website is now in colour.');
    });
    video.addEventListener('error', () => {
      if (video.error && sourceAssigned && (state === 'playing' || state === 'paused')) {
        finish('The full-colour website is ready. You can try the animation again.', true);
      }
    });

    const onMotionChange = (event) => {
      if (event.matches && (state === 'playing' || state === 'paused' || state === 'waiting')) {
        finish('Animation stopped. The website is now in colour.', true);
      }
    };
    if (typeof reducedMotion.addEventListener === 'function') {
      reducedMotion.addEventListener('change', onMotionChange);
      narrowScreen.addEventListener('change', updatePoster);
    } else {
      reducedMotion.addListener(onMotionChange);
      narrowScreen.addListener(updatePoster);
    }

    function welcomeArrival() {
      if (!allowsAutoplay()) {
        // No automatic video request for reduced-motion or data-saving modes.
        finish('', true);
      } else if (document.hidden) {
        // Mobile browsers may prepare a page before bringing it into view.
        // Keep the opening ready; the visitor should see the bird from the start.
        awaitingArrival = true;
        setState('waiting');
        setColour('mono');
      } else start();
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (state === 'playing') pause(true);
      } else if (awaitingArrival) {
        welcomeArrival();
      } else if (resumeWhenVisible && state === 'paused') {
        resumeWhenVisible = false;
        if (allowsAutoplay()) {
          announce('Animation resumed.');
          requestPlayback();
        } else finish('', true);
      }
    });

    window.addEventListener('pageshow', (event) => {
      // Back/forward cache restores skip normal script initialisation.
      if (event.persisted) welcomeArrival();
    });

    // Every opening gets the introduction; a previous visit never suppresses it.
    welcomeArrival();
  }

  function initialiseMap() {
    const button = document.getElementById('map-load');
    const container = document.getElementById('visit-map');
    if (!button || !container) return;

    let loaded = false;
    button.addEventListener('click', () => {
      if (loaded) return;
      let mapURL;
      try {
        mapURL = new URL(container.dataset.mapSrc);
        if (mapURL.protocol !== 'https:') return;
      } catch (_) {
        return;
      }

      const placeholder = container.querySelector('[data-map-placeholder], .map-placeholder');
      const frame = document.createElement('iframe');
      frame.className = 'visit-map-frame';
      frame.title = 'Map showing Dirty Janes Canberra in Fyshwick';
      frame.loading = 'lazy';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.allowFullscreen = true;
      frame.width = '100%';
      frame.height = '100%';
      frame.style.border = '0';
      frame.src = mapURL.href;
      frame.addEventListener('error', () => {
        loaded = false;
        container.classList.remove('is-loaded');
        if (placeholder) frame.replaceWith(placeholder);
        else frame.remove();
        button.hidden = false;
        button.focus({ preventScroll: true });
      }, { once: true });

      loaded = true;
      button.hidden = true;
      if (placeholder) placeholder.replaceWith(frame);
      else container.append(frame);
      container.classList.add('is-loaded');
      frame.focus({ preventScroll: true });
    });
  }

  function initialiseCopyAddress() {
    const button = document.getElementById('copy-address');
    const status = document.getElementById('copy-status');
    if (!button || !status) return;

    function fallbackCopy(address) {
      const previouslyFocused = document.activeElement;
      const field = document.createElement('textarea');
      field.value = address;
      field.setAttribute('readonly', '');
      field.setAttribute('aria-label', 'Address to copy');
      Object.assign(field.style, { position: 'fixed', left: '-9999px', top: '0' });
      document.body.append(field);
      field.select();
      field.setSelectionRange(0, address.length);
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } catch (_) {
        copied = false;
      } finally {
        field.remove();
        if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
          previouslyFocused.focus({ preventScroll: true });
        }
      }
      return copied;
    }

    button.addEventListener('click', async () => {
      const address = (button.dataset.address || '').trim();
      if (!address) return;
      status.textContent = '';
      let copied = false;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(address);
          copied = true;
        }
      } catch (_) {
        // A denied Clipboard API permission can still allow user-initiated copy.
      }
      if (!copied) copied = fallbackCopy(address);
      window.requestAnimationFrame(() => {
        status.textContent = copied ? 'Address copied to your clipboard.'
          : `Copy is unavailable. You can select this address: ${address}`;
      });
    });
  }

  function initialise() {
    initialiseNavigation();
    initialiseIntroduction();
    initialiseMap();
    initialiseCopyAddress();
    document.querySelectorAll('[data-year]').forEach((element) => {
      element.textContent = String(new Date().getFullYear());
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
})();
