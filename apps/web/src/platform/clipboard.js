// Older mobile WebViews need the selection-based copy command while the
// original tap is still active. Try it before awaiting any browser promise.
export async function copyText(text) {
  const previousFocus = document.activeElement;
  const selection = window.getSelection();
  const previousRanges = [];
  for (let index = 0; index < (selection?.rangeCount || 0); index++) {
    previousRanges.push(selection.getRangeAt(index).cloneRange());
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;font-size:16px;pointer-events:none;';
  document.body.append(field);
  let copied = false;
  try {
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, field.value.length);
    copied = document.execCommand('copy');
  } catch {
    // Continue with the asynchronous Clipboard API when selection copy fails.
  } finally {
    field.remove();
    previousFocus?.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of previousRanges) selection.addRange(range);
    }
  }
  if (copied) return true;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
