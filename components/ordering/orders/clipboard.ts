/**
 * Copy text to the clipboard from a click. Safari only accepts the Clipboard API while the click is still being handled,
 * so the text is built BEFORE the handler runs and writeText is called with no await in front of it. When the browser
 * refuses (no permission, an older browser, an iframe), the old selection-based copy is tried next; when that fails too
 * the caller gets false and shows the text in a box to copy by hand.
 */
export interface ClipboardDeps {
  writeText?: ((text: string) => Promise<void>) | null;
  /** the legacy copy (document.execCommand("copy") from a hidden text box); returns whether it worked */
  legacyCopy?: ((text: string) => boolean) | null;
}

function browserWriteText(): ((text: string) => Promise<void>) | null {
  if (typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.writeText !== "function") return null;
  return (text) => navigator.clipboard.writeText(text);
}

function browserLegacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.top = "0";
  box.style.left = "-9999px";
  box.style.opacity = "0";
  document.body.appendChild(box);
  try {
    box.select();
    box.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(box);
  }
}

/** Resolves true when the text reached the clipboard. Never rejects. Call it straight from the click handler. */
export function copyText(text: string, deps: ClipboardDeps = {}): Promise<boolean> {
  const write = deps.writeText === undefined ? browserWriteText() : deps.writeText;
  const legacy = deps.legacyCopy === undefined ? browserLegacyCopy : deps.legacyCopy;
  const fallback = () => {
    try {
      return Promise.resolve(legacy ? legacy(text) : false);
    } catch {
      return Promise.resolve(false);
    }
  };
  if (!write) return fallback();
  try {
    // no await before this call: the click is still being handled
    return write(text).then(
      () => true,
      () => fallback(),
    );
  } catch {
    return fallback();
  }
}
