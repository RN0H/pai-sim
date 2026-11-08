/**
 * The code panel: write a controller program (or load an example), run it,
 * stop it, and see its errors and console output. The program itself runs
 * in a Web Worker (src/control/); this file is DOM only.
 *
 * The code editor is a plain <textarea>: it works with screen readers, phone
 * keyboards and copy/paste everywhere, and costs nothing to load. Tab keeps
 * moving focus (it doesn't insert spaces), so keyboard users never get stuck.
 *
 * The Blocks view (Blockly) is loaded only when someone first opens it. The
 * blocks generate a program into the same textarea, so the Code view always
 * shows the code the blocks make, and Run always runs the textarea.
 *
 * The Code view can be JavaScript or Python (a "Language" menu). Each
 * language keeps its own code while the other is showing. Blocks make
 * JavaScript, so opening the Blocks view switches the code back to it.
 */
import { formatProgramError, type Language, type ProgramError } from "../control/api";
import { EXAMPLES, findExample } from "../control/examples";
import type { BlocksEditor } from "./blocksEditor";

export type EditorView = "code" | "blocks";

export interface CodePanelOptions {
  initialCode: string;
  /** What the editor shows on first switching to Python. */
  initialPython: string;
  onRun(code: string, language: Language): void;
  onStop(): void;
}

/** Console lines kept in the output box. */
const MAX_OUTPUT_LINES = 50;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

export class CodePanel {
  readonly editor: HTMLTextAreaElement;
  /** The first control in the panel (the examples menu). */
  readonly firstControl: HTMLSelectElement;
  private readonly runBtn: HTMLButtonElement;
  private readonly stopBtn: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly errorBox: HTMLElement;
  private readonly errorText: HTMLElement;
  private readonly errorLineBtn: HTMLButtonElement;
  private readonly output: HTMLElement;
  private outputLines: string[] = [];
  private errorLine: number | null = null;
  /** Bumped whenever the error box changes, so a delayed show can tell it's stale. */
  private errorSeq = 0;
  /** The user has typed since the last example was loaded (or the blocks last wrote the code). */
  private edited = false;
  private view: EditorView = "code";
  private readonly viewButtons: Record<EditorView, HTMLButtonElement>;
  private readonly codeParts: HTMLElement[];
  private readonly blocksParts: HTMLElement[];
  private readonly blocksBox: HTMLElement;
  private blocks: BlocksEditor | null = null;
  private blocksLoading: Promise<BlocksEditor | null> | null = null;
  /** The code the blocks last generated (what the textarea held then). */
  private blocksCode: string | null = null;
  /** The example last loaded into the Code view (its blocks are used on switching to Blocks). */
  private loadedExample: string | null = null;
  /** Bumped by every setView(), so a switch waiting for Blockly to load can tell it's stale. */
  private viewRequest = 0;
  /** The view the latest setView() asked for. */
  private viewTarget: EditorView = "code";
  private language: Language = "javascript";
  private readonly languageSelect: HTMLSelectElement;
  private readonly help: HTMLElement;
  /** The editor's state for the language that isn't showing. */
  private stashed: { value: string; edited: boolean; loadedExample: string | null };

  constructor(
    root: HTMLElement,
    opts: CodePanelOptions,
  ) {
    // ---- Examples ----------------------------------------------------------
    const exampleId = "code-example";
    const examples = (this.firstControl = el("select", { id: exampleId }));
    examples.add(new Option("Choose an example…", ""));
    for (const ex of EXAMPLES) examples.add(new Option(ex.name, ex.id));
    examples.addEventListener("change", () => {
      const ex = findExample(examples.value);
      examples.value = "";
      if (!ex) return;
      if (this.view === "blocks" && this.blocks) {
        if (this.blocks.edited && !this.confirmReplace("blocks")) return;
        this.blocks.loadExample(ex.id);
        this.setStatus(`Loaded the "${ex.name}" example as blocks. Press Run to try it.`);
        return;
      }
      const exCode = this.language === "python" ? ex.python : ex.code;
      if (this.edited && this.editor.value.trim() && this.editor.value !== exCode && !this.confirmReplace("code")) return;
      this.editor.value = exCode;
      this.edited = false;
      // Only JavaScript examples come along to the Blocks view.
      this.loadedExample = this.language === "javascript" ? ex.id : null;
      this.setStatus(`Loaded the "${ex.name}" example${this.language === "python" ? " in Python" : ""}. Press Run to try it.`);
    });
    const exampleRow = el(
      "div",
      { className: "c-row" },
      el("label", { htmlFor: exampleId }, "Examples"),
      examples,
    );

    // ---- Blocks / Code switch --------------------------------------------------
    const viewButton = (view: EditorView, text: string) => {
      const b = el("button", { type: "button", className: "c-view" }, text);
      b.setAttribute("aria-pressed", String(view === this.view));
      b.addEventListener("click", () => void this.setView(view));
      return b;
    };
    this.viewButtons = { blocks: viewButton("blocks", "Blocks"), code: viewButton("code", "Code") };
    const viewSwitch = el("div", { className: "c-views" }, this.viewButtons.blocks, this.viewButtons.code);
    viewSwitch.setAttribute("role", "group");
    viewSwitch.setAttribute("aria-label", "Write the program with");

    // ---- Blocks (filled in on first use) ----------------------------------------
    // Blockly labels its own workspace ("Blocks workspace", a region) for screen readers.
    this.blocksBox = el("div", { className: "c-blocks" });
    this.blocksBox.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.runBtn.click();
      }
    });
    const blocksHelp = el(
      "p",
      { className: "b-detail c-help" },
      "Drag blocks from the categories. Blocks inside ",
      el("strong", {}, "every tick"),
      " run 50 times a second. Blocks outside ",
      el("strong", {}, "when the program starts"),
      " or ",
      el("strong", {}, "every tick"),
      " don't run (they turn grey). Press Code to see the program they make.",
    );

    // ---- Language (Code view) ---------------------------------------------------
    const languageId = "code-language";
    this.languageSelect = el("select", { id: languageId });
    this.languageSelect.add(new Option("JavaScript", "javascript"));
    this.languageSelect.add(new Option("Python", "python"));
    this.languageSelect.addEventListener("change", () => this.setLanguage(this.languageSelect.value === "python" ? "python" : "javascript"));
    const languageRow = el("div", { className: "c-row" }, el("label", { htmlFor: languageId }, "Language"), this.languageSelect);
    this.stashed = { value: opts.initialPython, edited: false, loadedExample: null };

    // ---- Editor ------------------------------------------------------------
    const editorId = "code-editor";
    const helpId = "code-help";
    this.editor = el("textarea", {
      id: editorId,
      className: "c-editor",
      value: opts.initialCode,
      spellcheck: false,
      rows: 16,
    });
    this.editor.setAttribute("autocapitalize", "off");
    this.editor.setAttribute("autocomplete", "off");
    this.editor.setAttribute("autocorrect", "off");
    this.editor.setAttribute("aria-describedby", helpId);
    this.editor.setAttribute("wrap", "off");
    this.editor.addEventListener("input", () => {
      this.edited = true;
      this.loadedExample = null;
    });
    // Ctrl/Cmd+Enter runs, like many code playgrounds.
    this.editor.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.runBtn.click();
      }
    });
    const help = (this.help = el("p", { id: helpId, className: "b-detail c-help" }));
    this.showHelp();

    // ---- Run / stop ----------------------------------------------------------
    this.runBtn = el("button", { type: "button", className: "c-run" }, "Run");
    this.stopBtn = el("button", { type: "button", className: "c-stop", disabled: true }, "Stop");
    this.runBtn.addEventListener("click", () => {
      // Blockly reports changes a moment later; take the blocks' latest code now.
      if (this.view === "blocks" && this.blocks) this.fromBlocks(this.blocks.code());
      opts.onRun(this.editor.value, this.view === "blocks" ? "javascript" : this.language);
    });
    this.stopBtn.addEventListener("click", () => opts.onStop());
    this.status = el("p", { className: "c-status", role: "status" });
    const buttons = el("div", { className: "c-buttons" }, this.runBtn, this.stopBtn);

    // ---- Error + output ------------------------------------------------------
    this.errorText = el("span");
    this.errorLineBtn = el("button", { type: "button", className: "b-show" }, "Show line");
    this.errorLineBtn.addEventListener("click", () => this.selectLine(this.errorLine));
    this.errorBox = el(
      "div",
      { className: "b-errors c-error", role: "alert" },
      el("strong", {}, "Your program stopped. "),
      this.errorText,
      " ",
      this.errorLineBtn,
    );
    this.errorBox.hidden = true;
    this.output = el("pre", { className: "c-output", tabIndex: 0 });
    this.output.setAttribute("aria-label", "Program output");
    this.output.hidden = true;

    const editorLabel = el("label", { htmlFor: editorId, className: "c-label" }, "Program");
    this.codeParts = [languageRow, editorLabel, this.editor, help];
    this.blocksParts = [this.blocksBox, blocksHelp];
    for (const p of this.blocksParts) p.hidden = true;

    root.append(
      exampleRow,
      viewSwitch,
      languageRow,
      editorLabel,
      this.editor,
      help,
      this.blocksBox,
      blocksHelp,
      buttons,
      this.status,
      this.errorBox,
      this.output,
    );
  }

  /** Reflect whether a program is running. */
  setRunning(running: boolean, message?: string): void {
    this.runBtn.textContent = running ? "Restart" : "Run";
    this.stopBtn.disabled = !running;
    if (running) {
      this.clearError();
      this.outputLines = [];
      this.output.textContent = "";
      this.output.hidden = true;
    }
    if (message !== undefined) this.setStatus(message);
  }

  showError(err: ProgramError): void {
    const seq = ++this.errorSeq;
    this.errorLine = err.line;
    this.errorLineBtn.hidden = err.line === null;
    // Clear first so screen readers announce the same error again.
    this.errorBox.hidden = true;
    this.errorText.textContent = "";
    const text = formatProgramError(err);
    requestAnimationFrame(() => {
      if (this.errorSeq !== seq) return; // replaced or cleared meanwhile
      this.errorText.textContent = text;
      this.errorBox.hidden = false;
    });
    this.setStatus("");
  }

  clearError(): void {
    this.errorSeq++;
    this.errorLine = null;
    this.errorBox.hidden = true;
  }

  addOutput(lines: string[]): void {
    this.outputLines.push(...lines);
    if (this.outputLines.length > MAX_OUTPUT_LINES) this.outputLines.splice(0, this.outputLines.length - MAX_OUTPUT_LINES);
    this.output.textContent = this.outputLines.join("\n");
    this.output.hidden = false;
    this.output.scrollTop = this.output.scrollHeight;
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
  }

  /** The Code view's language. */
  get currentLanguage(): Language {
    return this.language;
  }

  /** Switch the Code view's language; each language keeps its own code. */
  setLanguage(language: Language): void {
    this.languageSelect.value = language;
    if (language === this.language) return;
    const showing = { value: this.editor.value, edited: this.edited, loadedExample: this.loadedExample };
    this.editor.value = this.stashed.value;
    this.edited = this.stashed.edited;
    this.loadedExample = this.stashed.loadedExample;
    this.stashed = showing;
    this.language = language;
    this.showHelp();
    this.setStatus(
      language === "python"
        ? "Python. The first run downloads Python (about 12 MB), so it takes a while to start."
        : "JavaScript.",
    );
  }

  private showHelp(): void {
    const py = this.language === "python";
    this.help.replaceChildren(
      "Use ",
      el("code", {}, py ? "robot.set_wheels(left, right)" : "robot.setWheels(left, right)"),
      " (−1 to 1), ",
      el("code", {}, 'robot.read("distance")'),
      " and ",
      el("code", {}, "robot.time"),
      ". Code in ",
      el("code", {}, py ? "def loop():" : "function loop()"),
      " runs 50 times a second. Ctrl+Enter runs.",
    );
  }

  /** Which editor is showing. */
  get currentView(): EditorView {
    return this.view;
  }

  /**
   * Show the blocks or the code. The first switch to blocks loads Blockly.
   * Blocks can't be made from code, so going back to blocks after editing
   * the code asks first: the blocks' code replaces those edits.
   */
  async setView(view: EditorView): Promise<void> {
    const request = ++this.viewRequest;
    this.viewTarget = view;
    if (view === "code") {
      if (this.blocksLoading) this.setStatus(""); // a pending switch to blocks is cancelled
      if (this.view === "code") return;
      this.hidePopups();
      this.view = "code";
      this.showView();
      this.setStatus("Code view: this is the program your blocks make.");
      return;
    }
    if (this.view === "blocks") return;
    // Blocks make JavaScript: show it (and put Python back if the switch doesn't happen).
    const before = this.language;
    if (before !== "javascript") this.setLanguage("javascript");
    const undoLanguage = () => {
      if (before !== this.language) this.setLanguage(before);
    };
    const example = this.loadedExample !== null && this.editor.value === findExample(this.loadedExample)?.code ? findExample(this.loadedExample)! : null;
    const edits = this.edited && this.editor.value.trim() !== "" && this.editor.value !== this.blocksCode;
    if (edits && !window.confirm("Switch to blocks? Blocks can't be made from code, so your code changes will be replaced by the blocks' program.")) {
      undoLanguage();
      return;
    }
    const blocks = await this.loadBlocks();
    if (!blocks) {
      undoLanguage();
      return;
    }
    // Stale: the user pressed Code (or Blocks again) while Blockly was loading.
    if (request !== this.viewRequest) {
      if (this.viewTarget === "code") undoLanguage();
      return;
    }
    this.view = "blocks";
    this.showView();
    blocks.resize();
    // An example just loaded as code comes along as its blocks.
    let status = "Blocks view. Drag blocks in, then press Run.";
    if (example && (!blocks.edited || window.confirm(`Replace your blocks with the "${example.name}" example?`))) {
      blocks.loadExample(example.id);
      status = `Loaded the "${example.name}" example as blocks. Press Run to try it.`;
    }
    this.loadedExample = null;
    this.fromBlocks(blocks.code());
    this.setStatus(status);
  }

  /** Close any open Blockly menu or field editor (they float over the page). */
  hidePopups(): void {
    this.blocks?.hidePopups();
  }

  private loadBlocks(): Promise<BlocksEditor | null> {
    if (this.blocks) return Promise.resolve(this.blocks);
    if (this.blocksLoading) return this.blocksLoading;
    this.setStatus("Loading blocks…");
    this.viewButtons.blocks.setAttribute("aria-busy", "true");
    // Nothing typed or picked meanwhile may be lost when the blocks take over.
    this.editor.readOnly = true;
    this.firstControl.disabled = true;
    this.languageSelect.disabled = true;
    this.blocksLoading = import("./blocksEditor")
      .then(({ BlocksEditor }) => {
        // Blockly measures its container, so it must be on screen while it starts.
        const wasHidden = this.blocksBox.hidden;
        this.blocksBox.hidden = false;
        try {
          this.blocks = new BlocksEditor(this.blocksBox, { onChange: (code) => this.fromBlocks(code) });
        } finally {
          this.blocksBox.hidden = wasHidden;
        }
        return this.blocks;
      })
      .catch(() => {
        // Browsers remember a failed import(), so only a reload retries it.
        this.setStatus("The blocks couldn't load. Check your internet connection and reload the page.");
        return null;
      })
      .finally(() => {
        this.blocksLoading = null;
        this.viewButtons.blocks.removeAttribute("aria-busy");
        this.editor.readOnly = false;
        this.firstControl.disabled = false;
        this.languageSelect.disabled = false;
      });
    return this.blocksLoading;
  }

  /** The blocks changed: their program becomes the code. */
  private fromBlocks(code: string): void {
    if (this.view !== "blocks") return; // edits in the Code view are kept until switching back
    this.editor.value = code;
    this.blocksCode = code;
    this.edited = false;
  }

  private showView(): void {
    const blocks = this.view === "blocks";
    for (const p of this.codeParts) p.hidden = blocks;
    for (const p of this.blocksParts) p.hidden = !blocks;
    this.viewButtons.blocks.setAttribute("aria-pressed", String(blocks));
    this.viewButtons.code.setAttribute("aria-pressed", String(!blocks));
  }

  private confirmReplace(what: "code" | "blocks"): boolean {
    // Plain confirm(): accessible everywhere, and losing code by accident is worse.
    return window.confirm(`Replace your ${what} with this example?`);
  }

  /** Focus the editor with line `line` (1-based) selected. */
  private selectLine(line: number | null): void {
    if (line === null) return;
    // Line numbers are in the code, so show it (the blocks made it).
    if (this.view === "blocks") {
      this.view = "code";
      this.showView();
    }
    const lines = this.editor.value.split("\n");
    let start = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) start += lines[i]!.length + 1;
    const end = start + (lines[line - 1]?.length ?? 0);
    this.editor.focus();
    this.editor.setSelectionRange(start, end);
    // Scroll the line into view (textarea has no API for it).
    const lineHeight = parseFloat(getComputedStyle(this.editor).lineHeight) || 18;
    this.editor.scrollTop = Math.max(0, (line - 3) * lineHeight);
  }
}
