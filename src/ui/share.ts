/**
 * Share and remix UI (DOM only; links themselves are made in src/share/).
 *
 * - The Share button makes a link to the sim, copies it, and shows it in a
 *   small dialog (so it can be copied by hand where the clipboard is blocked).
 * - The remix bar shows on a page opened from a link: you're editing a copy,
 *   remixed from that link (and, if it was a remix itself, from its parent).
 */

export type LinkResult = { ok: true; url: string; remixOf: { name: string; url: string } | null } | { ok: false; reason: string };

export interface ShareDialogOptions {
  /** Make the link for the sim as it is now. */
  makeLink(): Promise<LinkResult>;
}

/** Links longer than this may be cut by some chat apps and browsers. */
const LONG_LINK = 2000;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

/**
 * Start copying a link that's still being made. Must be called during the
 * click: Safari only allows clipboard writes inside the user's gesture, and
 * `ClipboardItem` takes a promise for exactly this. Resolves false when it
 * didn't work (the caller then tries the other ways).
 */
function copyLater(link: Promise<LinkResult>): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "function" || !navigator.clipboard?.write) return Promise.resolve(false);
    const blob = link.then((l) => (l.ok ? new Blob([l.url], { type: "text/plain" }) : Promise.reject(new Error(l.reason))));
    return navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

/** Copy `text`; false when the browser won't let us (the user copies it by hand). */
async function copyText(text: string, field: HTMLInputElement): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Blocked (no permission, not a secure page): try the old way.
  }
  try {
    field.focus();
    field.select();
    // Deprecated, but the only way on older browsers (and it needs no permission).
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

export class ShareDialog {
  private readonly field: HTMLInputElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly note: HTMLElement;
  private readonly linkPart: HTMLElement;
  private readonly heading: HTMLElement;
  private request = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly toggle: HTMLButtonElement,
    private readonly opts: ShareDialogOptions,
  ) {
    const body = root.querySelector<HTMLElement>("[data-share-body]")!;
    this.heading = root.querySelector<HTMLElement>("h2")!;
    this.heading.tabIndex = -1;
    const fieldId = "share-link";
    this.field = el("input", { id: fieldId, type: "text", readOnly: true, className: "share-field" });
    this.field.setAttribute("aria-describedby", "share-about");
    this.field.addEventListener("focus", () => this.field.select());
    this.copyBtn = el("button", { type: "button", className: "c-run" }, "Copy link");
    this.copyBtn.addEventListener("click", () => void this.copy());
    this.status = el("p", { className: "share-status", role: "status" });
    this.note = el("p", { className: "b-detail share-note" });
    this.linkPart = el(
      "div",
      { className: "share-link" },
      el("label", { htmlFor: fieldId }, "Link"),
      el("div", { className: "share-row" }, this.field, this.copyBtn),
      el(
        "p",
        { id: "share-about", className: "b-detail" },
        "Anyone who opens it gets this robot, its program and its environment, and can remix their own copy. Nothing is uploaded: the whole sim is in the link.",
      ),
      this.note,
    );
    body.append(this.linkPart, this.status);

    toggle.addEventListener("click", () => (root.hidden ? void this.open() : this.close()));
    root.querySelector("[data-share-close]")!.addEventListener("click", () => this.close());
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Make a link to the sim as it is now, copy it, and show it. */
  async open(): Promise<void> {
    const req = ++this.request;
    this.root.hidden = false;
    this.toggle.setAttribute("aria-expanded", "true");
    this.linkPart.hidden = true;
    this.status.textContent = "Making the link…";
    this.heading.focus();
    const making = this.opts.makeLink().catch(
      (): LinkResult => ({ ok: false, reason: "Something went wrong making the link. Try again." }),
    );
    const copied = copyLater(making);
    const link = await making;
    if (req !== this.request || this.root.hidden) return;
    if (!link.ok) {
      this.status.textContent = link.reason;
      this.root.querySelector<HTMLElement>("[data-share-close]")!.focus();
      return;
    }
    this.field.value = link.url;
    this.note.replaceChildren();
    if (link.remixOf) {
      this.note.append(
        "It's a remix: the link remembers it was remixed from ",
        el("a", { href: link.remixOf.url, target: "_blank", rel: "noopener" }, `“${link.remixOf.name}”`),
        ". ",
      );
    }
    if (link.url.length > LONG_LINK) {
      this.note.append(`This link is long (${link.url.length.toLocaleString("en")} characters); some apps may cut it short. A shorter program makes a shorter link.`);
    }
    this.note.hidden = this.note.childNodes.length === 0;
    this.linkPart.hidden = false;
    await this.copy(await copied);
  }

  close(): void {
    if (this.root.hidden) return;
    this.request++;
    this.root.hidden = true;
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.focus();
  }

  private async copy(alreadyCopied = false): Promise<void> {
    const ok = alreadyCopied || (await copyText(this.field.value, this.field));
    // Clear first so a repeated message is announced again.
    this.status.textContent = "";
    const said = ok ? "Link copied. Paste it anywhere to share your sim." : "Select the link above and copy it to share your sim.";
    requestAnimationFrame(() => (this.status.textContent = said));
    if (ok) this.copyBtn.focus();
    else {
      this.field.focus();
      this.field.select();
    }
  }
}

export interface RemixInfo {
  /** Name of the shared sim (the robot's or the scene's). */
  name: string;
  /** The link this page was opened from. */
  url: string;
  /** The link that one was remixed from, if any. */
  parent: { name: string; url: string } | null;
  /** Runs the link's program (absent when it has none). */
  run?: () => void;
  /** Where focus goes when the bar is dismissed. */
  afterDismiss?: HTMLElement;
}

/** The "Remixed from …" bar on a page opened from a share link. */
export class RemixBar {
  constructor(private readonly root: HTMLElement) {}

  show(info: RemixInfo): void {
    const link = (name: string, url: string) => el("a", { href: url, target: "_blank", rel: "noopener" }, `“${name}”`);
    const text = el(
      "p",
      { className: "remix-text" },
      el("strong", {}, "Remixed from ", link(info.name, info.url)),
      ": you're editing your own copy; that link won't change. Press Share for a link to yours.",
    );
    if (info.parent) text.append(" ", el("span", { className: "remix-parent" }, "It was itself remixed from ", link(info.parent.name, info.parent.url), "."));
    const buttons = el("div", { className: "remix-buttons" });
    if (info.run) {
      const run = info.run;
      const runBtn = el("button", { type: "button", className: "c-run" }, "Run its program");
      runBtn.addEventListener("click", () => run());
      buttons.append(runBtn);
    }
    const close = el("button", { type: "button" }, "Dismiss");
    close.setAttribute("aria-label", "Dismiss the remix note");
    close.addEventListener("click", () => {
      this.root.hidden = true;
      info.afterDismiss?.focus();
    });
    buttons.append(close);
    this.root.replaceChildren(text, buttons);
    this.root.hidden = false;
  }
}
