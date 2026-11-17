for (const button of document.querySelectorAll('[data-copy]')) {
  const source = document.getElementById(button.dataset.copy);
  const status = document.getElementById(button.getAttribute('aria-describedby'));
  if (!source || !status) continue;

  button.hidden = false;
  button.addEventListener('click', async () => {
    status.textContent = '';
    try {
      await navigator.clipboard.writeText(source.textContent.trim());
      status.textContent = 'Copied to clipboard.';
    } catch {
      const selection = window.getSelection();
      if (!selection) {
        status.textContent = 'Could not copy. Select the text and copy it manually.';
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(source);
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = 'Could not copy. The text is selected. Copy it manually.';
    }
  });
}
