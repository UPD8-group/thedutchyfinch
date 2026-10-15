/* Local client preview only: this flow never submits an order or payment. */
(() => {
  const button = document.getElementById('complete-demo');
  const result = document.getElementById('demo-result');
  const title = document.getElementById('demo-result-title');
  if (!button || !result || !title) return;

  button.hidden = false;
  button.addEventListener('click', () => {
    button.hidden = true;
    result.hidden = false;
    title.focus({ preventScroll: true });
  }, { once: true });
})();
