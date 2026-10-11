/* Optional gallery controls. Every photo remains an ordinary link without JS. */
(() => {
  'use strict';

  function initialiseExpansion() {
    const extras = Array.from(document.querySelectorAll('[data-gallery-extra]'));
    const button = document.getElementById('gallery-expand');
    const label = document.getElementById('gallery-expand-label');
    if (!extras.length || !button || !label) return;

    let expanded = false;
    const update = () => {
      extras.forEach((card) => { card.hidden = !expanded; });
      button.setAttribute('aria-expanded', String(expanded));
      label.textContent = expanded ? 'Show fewer photos' : 'See all 12 photos';
    };

    update();
    button.hidden = false;
    button.addEventListener('click', () => {
      expanded = !expanded;
      update();
      const firstRevealedLink = expanded
        ? extras.map((card) => card.querySelector('[data-gallery-item]')).find(Boolean)
        : null;
      const focusTarget = firstRevealedLink || button;
      focusTarget.focus({ preventScroll: true });
      // Keep the newly available photo, or the collapsing control, in view.
      // The site's reduced-motion rule controls any smooth scrolling.
      focusTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  function initialiseLightbox() {
    const dialog = document.getElementById('photo-dialog');
    let image = document.getElementById('photo-dialog-image');
    const caption = document.getElementById('photo-dialog-caption');
    const count = document.getElementById('photo-dialog-count');
    const status = document.getElementById('photo-dialog-status');
    const closeButton = document.getElementById('photo-dialog-close');
    const previousButton = document.getElementById('photo-dialog-prev');
    const nextButton = document.getElementById('photo-dialog-next');
    const directLink = document.getElementById('photo-dialog-open');

    if (!dialog || typeof dialog.showModal !== 'function' || typeof dialog.close !== 'function'
      || !image || !caption || !count || !status || !closeButton
      || !previousButton || !nextButton || !directLink) return;

    const stage = dialog.querySelector('.photo-dialog-stage');
    const errorMessage = dialog.querySelector('.photo-dialog-error');
    const items = Array.from(document.querySelectorAll('a[data-gallery-item]')).flatMap((anchor) => {
      try {
        const href = anchor.getAttribute('href');
        if (!href) return [];
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin || !['https:', 'http:'].includes(url.protocol)) return [];
        const thumbnail = anchor.querySelector('img');
        const title = (anchor.dataset.caption || '').trim();
        const alt = thumbnail ? (thumbnail.getAttribute('alt') || '').trim() : '';
        return [{ anchor, url: url.href, title: title || alt || 'The Dutchy Finch', alt: alt || title }];
      } catch (_) {
        return [];
      }
    });
    if (!items.length) return;

    let index = -1;
    let opener = null;
    let request = 0;
    let swipe = null;
    let touchCancelled = false;

    directLink.target = '_blank';
    directLink.rel = 'noopener noreferrer';
    previousButton.disabled = items.length < 2;
    nextButton.disabled = items.length < 2;

    function setLoading(loading) {
      dialog.classList.toggle('is-loading', loading);
      if (stage) stage.setAttribute('aria-busy', String(loading));
    }

    function releaseImage() {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
      image.removeAttribute('srcset');
      image.hidden = true;
    }

    function showPhoto(nextIndex) {
      if (!dialog.open) return;
      index = (nextIndex + items.length) % items.length;
      const item = items[index];
      const thisRequest = ++request;
      const position = `${index + 1} of ${items.length}`;

      caption.textContent = item.title;
      count.textContent = position;
      directLink.href = item.url;
      status.textContent = `Loading photo ${position}.`;
      if (errorMessage) errorMessage.hidden = true;
      setLoading(true);

      // A separate node gives each request its own load/error events. A late
      // response for a previous photo cannot complete the current request.
      const nextImage = document.createElement('img');
      nextImage.id = 'photo-dialog-image';
      nextImage.className = image.className;
      nextImage.alt = item.alt;
      nextImage.loading = 'eager';
      nextImage.decoding = 'async';
      nextImage.hidden = true;
      releaseImage();
      image.replaceWith(nextImage);
      image = nextImage;

      nextImage.onload = () => {
        if (thisRequest !== request || image !== nextImage || !dialog.open) return;
        if (nextImage.naturalWidth && nextImage.naturalHeight) {
          nextImage.style.aspectRatio = `${nextImage.naturalWidth} / ${nextImage.naturalHeight}`;
        }
        nextImage.hidden = false;
        setLoading(false);
        status.textContent = `Photo ${position}: ${item.title}.`;
      };
      nextImage.onerror = () => {
        if (thisRequest !== request || image !== nextImage || !dialog.open) return;
        releaseImage();
        setLoading(false);
        if (errorMessage) {
          errorMessage.textContent = 'This photo could not be loaded. Use “Open photo in a new tab” to view it separately.';
          errorMessage.hidden = false;
        }
        status.textContent = `Photo ${position} could not be loaded. You can open it in a new tab using the photo link.`;
      };
      // No other full-size photo is fetched or preloaded in the background.
      nextImage.src = item.url;
    }

    function cleanUp() {
      request += 1;
      swipe = null;
      touchCancelled = false;
      releaseImage();
      setLoading(false);
      if (errorMessage) errorMessage.hidden = true;
      status.textContent = '';
      document.body.classList.remove('gallery-open');
      index = -1;
      const returnTarget = opener;
      opener = null;
      if (returnTarget && returnTarget.isConnected) returnTarget.focus({ preventScroll: true });
    }

    function closeDialog() {
      if (dialog.open) dialog.close();
      cleanUp();
    }

    function openDialog(itemIndex, anchor) {
      try {
        dialog.showModal();
      } catch (_) {
        // Leave the original link action available if native opening fails.
        return false;
      }
      opener = anchor;
      document.body.classList.add('gallery-open');
      showPhoto(itemIndex);
      closeButton.focus({ preventScroll: true });
      return true;
    }

    items.forEach((item, itemIndex) => {
      item.anchor.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey
          || event.shiftKey || event.altKey || item.anchor.hasAttribute('download')) return;
        if (openDialog(itemIndex, item.anchor)) event.preventDefault();
      });
    });

    closeButton.addEventListener('click', closeDialog);
    previousButton.addEventListener('click', () => showPhoto(index - 1));
    nextButton.addEventListener('click', () => showPhoto(index + 1));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDialog();
    });
    dialog.addEventListener('close', () => {
      // A queued close event must not clear a modal that has since reopened.
      if (!dialog.open) cleanUp();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      const outside = event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom;
      if (outside) closeDialog();
    });
    dialog.addEventListener('keydown', (event) => {
      if (!dialog.open || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const destinations = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: items.length - 1 };
      if (!Object.prototype.hasOwnProperty.call(destinations, event.key)) return;
      event.preventDefault();
      showPhoto(destinations[event.key]);
    });

    if (stage) {
      const zoomed = () => window.visualViewport && window.visualViewport.scale > 1.05;
      stage.addEventListener('touchstart', (event) => {
        if (event.touches.length !== 1 || zoomed()) {
          swipe = null;
          touchCancelled = true;
          return;
        }
        if (touchCancelled) return;
        const touch = event.touches[0];
        swipe = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: Date.now() };
      }, { passive: true });
      stage.addEventListener('touchmove', (event) => {
        if (event.touches.length !== 1 || zoomed()) {
          swipe = null;
          touchCancelled = true;
        }
      }, { passive: true });
      stage.addEventListener('touchend', (event) => {
        if (event.touches.length) {
          swipe = null;
          touchCancelled = true;
          return;
        }
        const gesture = swipe;
        const cancelled = touchCancelled;
        swipe = null;
        touchCancelled = false;
        if (!gesture || cancelled || zoomed() || !dialog.open) return;
        const touch = Array.from(event.changedTouches).find((point) => point.identifier === gesture.id);
        if (!touch) return;
        const horizontal = touch.clientX - gesture.x;
        const vertical = touch.clientY - gesture.y;
        if (Date.now() - gesture.time <= 900 && Math.abs(horizontal) >= 60
          && Math.abs(horizontal) > Math.abs(vertical) * 1.5) {
          showPhoto(index + (horizontal < 0 ? 1 : -1));
        }
      }, { passive: true });
      stage.addEventListener('touchcancel', () => {
        swipe = null;
        touchCancelled = false;
      }, { passive: true });
    }
  }

  function initialise() {
    initialiseExpansion();
    initialiseLightbox();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
})();
