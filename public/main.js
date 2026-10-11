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
    const imageAnimation = document.getElementById('hero-animation');
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
    const START_TIMEOUT = 4000;
    const LOAD_TIMEOUT = 12000;
    const narrowScreen = window.matchMedia('(max-width: 700px)');
    // A normal animated image does not depend on permission to play video.
    // Coarse pointers include phones in landscape and larger touch devices.
    const imageFirst = narrowScreen.matches || window.matchMedia('(pointer: coarse)').matches;
    // Pick one video asset. Resizing never silently downloads the other version.
    const videoSource = narrowScreen.matches
      ? video.dataset.mobileSrc || video.dataset.desktopSrc
      : video.dataset.desktopSrc || video.dataset.mobileSrc;

    let state = 'finished';
    let colour = 'mono';
    let sourceAssigned = false;
    let operation = 0;
    let timeout = 0;
    let animationFrame = 0;
    let awaitingArrival = false;
    let resumeWhenVisible = false;
    let renderer = 'video';
    let hasVideoFrame = false;
    let hasPlayed = false;
    let useImageAnimation = imageFirst;
    let imageBlob = null;
    let imageURL = '';
    let imageRequest = null;

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
        : nextState === 'waiting' || !hasPlayed ? 'Play animation' : 'Replay animation';
      label.textContent = action;
      toggle.setAttribute('aria-label', action);
      // Animated images have no native pause API. Skip remains available.
      toggle.hidden = renderer === 'image' && nextState === 'playing';
      if (skip) skip.hidden = !['playing', 'paused', 'waiting'].includes(nextState);
      if (toggle.hidden && document.activeElement === toggle && skip) {
        skip.focus({ preventScroll: true });
      }
    }

    function clearTimers() {
      window.clearTimeout(timeout);
      window.cancelAnimationFrame(animationFrame);
      timeout = 0;
      animationFrame = 0;
    }

    function releaseImage() {
      if (imageRequest) imageRequest.abort();
      imageRequest = null;
      if (imageAnimation) {
        imageAnimation.onload = null;
        imageAnimation.onerror = null;
        imageAnimation.hidden = true;
        imageAnimation.removeAttribute('src');
      }
      if (imageURL) URL.revokeObjectURL(imageURL);
      imageURL = '';
    }

    function finish(message = '', releaseSource = false) {
      operation += 1;
      awaitingArrival = false;
      resumeWhenVisible = false;
      clearTimers();
      releaseImage();
      const skipHadFocus = skip && document.activeElement === skip;
      setState('finished');
      video.autoplay = false;
      video.pause();
      video.classList.remove('is-visible');
      setColour('colour');
      // Skipping, departures and failures also stop a pending download.
      if (releaseSource && sourceAssigned) {
        video.removeAttribute('src');
        video.preload = 'none';
        sourceAssigned = false;
        video.load();
      }
      if (message) announce(message);
      if (skipHadFocus) toggle.focus({ preventScroll: true });
    }

    function prepareArrival() {
      finish('', true);
      awaitingArrival = true;
      setState('waiting');
      // Prepare the cached page's snapshot too, before pageshow or focus.
      root.dataset.introPending = 'true';
      setColour('mono');
    }

    function armTimeout() {
      window.clearTimeout(timeout);
      const currentOperation = operation;
      timeout = window.setTimeout(() => {
        if (currentOperation === operation && state === 'playing' && renderer === 'video') {
          startImageAnimation();
        }
      }, !hasVideoFrame ? START_TIMEOUT : LOAD_TIMEOUT);
    }

    function checkColourCue() {
      if (renderer === 'video' && state === 'playing' && video.currentTime >= COLOUR_CUE && colour !== 'colour') {
        setColour('colour');
      }
    }

    function followPlayback() {
      checkColourCue();
      if (renderer === 'video' && state === 'playing') animationFrame = window.requestAnimationFrame(followPlayback);
    }

    async function startImageAnimation() {
      if (renderer === 'image') return;
      const source = imageAnimation && imageAnimation.dataset.fallbackSrc;
      if (!source) {
        finish('The full-colour website is ready. Select play to watch the animation.', true);
        return;
      }

      const currentOperation = ++operation;
      clearTimers();
      releaseImage();
      renderer = 'image';
      useImageAnimation = true;
      resumeWhenVisible = false;
      setState('playing');
      video.autoplay = false;
      video.pause();
      video.classList.remove('is-visible');
      if (sourceAssigned) {
        video.removeAttribute('src');
        video.preload = 'none';
        sourceAssigned = false;
        video.load();
      }
      setColour('mono');
      announce('The finch is arriving. You can skip the animation.');
      // A slow connection must not skip an arrival that has not played yet.
      // Keep the opening artwork and Skip available until loading resolves.

      try {
        if (!imageBlob) {
          const controller = new AbortController();
          imageRequest = controller;
          const response = await fetch(source, { signal: controller.signal });
          if (!response.ok) throw new Error('Animation unavailable');
          const blob = await response.blob();
          if (currentOperation !== operation) return;
          imageBlob = blob;
          imageRequest = null;
        }
        if (currentOperation !== operation || state !== 'playing') return;

        // Each playback gets a new image resource identity, so a cached clip
        // starts at frame one. Its downloaded bytes are reused for Replay.
        imageURL = URL.createObjectURL(imageBlob);
        imageAnimation.onload = () => {
          if (currentOperation !== operation || state !== 'playing') return;
          window.clearTimeout(timeout);
          hasPlayed = true;
          imageAnimation.hidden = false;
          revealPoster();
          const startedAt = performance.now();
          const duration = Number(imageAnimation.dataset.durationMs) || 8083;
          const followImage = () => {
            if (currentOperation !== operation || state !== 'playing') return;
            const elapsed = performance.now() - startedAt;
            if (elapsed >= COLOUR_CUE * 1000 && colour !== 'colour') setColour('colour');
            if (elapsed >= duration) {
              finish('The finch has landed. The website is now in colour.');
            } else animationFrame = window.requestAnimationFrame(followImage);
          };
          followImage();
        };
        imageAnimation.onerror = () => {
          if (currentOperation !== operation) return;
          useImageAnimation = imageFirst;
          imageBlob = null;
          finish('The full-colour website is ready. You can try the animation again.', true);
        };
        imageAnimation.src = imageURL;
      } catch (_) {
        if (currentOperation !== operation) return;
        useImageAnimation = imageFirst;
        finish('The full-colour website is ready. You can try the animation again.', true);
      }
    }

    function requestPlayback() {
      const currentOperation = ++operation;
      setState('playing');
      video.autoplay = true;
      video.poster = narrowScreen.matches ? poster.dataset.openingMobile : poster.dataset.openingDesktop;
      // Be visible before requesting playback, with the monochrome poster ready.
      video.classList.add('is-visible');
      armTimeout();
      try {
        const playRequest = video.play();
        if (playRequest && typeof playRequest.catch === 'function') {
          playRequest.catch(() => {
            // Ignore promises cancelled by the visitor pausing or skipping.
            if (currentOperation === operation && state === 'playing') {
              if (document.hidden) pause(true);
              else startImageAnimation();
            }
          });
        }
      } catch (_) {
        if (currentOperation === operation) {
          if (document.hidden) pause(true);
          else startImageAnimation();
        }
      }
    }

    function start() {
      operation += 1;
      awaitingArrival = false;
      resumeWhenVisible = false;
      clearTimers();
      releaseImage();
      renderer = 'video';
      hasVideoFrame = false;
      video.autoplay = false;
      video.pause();
      video.classList.remove('is-visible');

      if (useImageAnimation) {
        startImageAnimation();
        return;
      }
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
      video.autoplay = false;
      video.pause();
      announce('Animation paused.');
    }

    toggle.addEventListener('click', () => {
      if (renderer === 'image' && state === 'playing') return;
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
      if (renderer !== 'video' || state !== 'playing') {
        video.pause();
        return;
      }
      hasVideoFrame = true;
      hasPlayed = true;
      window.clearTimeout(timeout);
      video.classList.add('is-visible');
      window.cancelAnimationFrame(animationFrame);
      followPlayback();
    });
    video.addEventListener('timeupdate', checkColourCue);
    video.addEventListener('pause', () => {
      // Keep the controls honest if the browser or device interrupts playback.
      // Our own pause/finish actions already update state before pausing video.
      if (renderer === 'video' && state === 'playing' && video.paused && !video.ended) {
        if (document.hidden) pause(true);
        else startImageAnimation();
      }
    });
    video.addEventListener('waiting', () => {
      if (renderer === 'video' && state === 'playing') armTimeout();
    });
    video.addEventListener('ended', () => {
      if (renderer === 'video' && state === 'playing') finish('The finch has landed. The website is now in colour.');
    });
    video.addEventListener('error', () => {
      if (renderer === 'video' && video.error && sourceAssigned && state === 'playing') {
        startImageAnimation();
      }
    });

    if (typeof narrowScreen.addEventListener === 'function') {
      narrowScreen.addEventListener('change', updatePoster);
    } else {
      narrowScreen.addListener(updatePoster);
    }

    function welcomeArrival() {
      if (document.hidden) {
        // Mobile browsers may prepare a page before bringing it into view.
        // Keep the opening ready; the visitor should see the bird from the start.
        prepareArrival();
      } else start();
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (state === 'finished' || (state === 'playing' && renderer === 'image')) {
          // A one-shot image cannot pause. Restart from its first frame when
          // visible again, instead of returning to a film that ran off-screen.
          prepareArrival();
        } else if (state === 'playing') pause(true);
      } else if (awaitingArrival) {
        welcomeArrival();
      } else if (resumeWhenVisible && state === 'paused') {
        resumeWhenVisible = false;
        announce('Animation resumed.');
        requestPlayback();
      }
    });

    window.addEventListener('pageshow', (event) => {
      // Back/forward cache restores skip normal script initialisation.
      if (event.persisted) welcomeArrival();
    });
    window.addEventListener('pagehide', prepareArrival);

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
