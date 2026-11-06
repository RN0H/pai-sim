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
 */
import { formatProgramError, type ProgramError } from "../control/api";
import { EXAMPLES, findExample } from "../control/examples";
import type { BlocksEditor } from "./blocksEditor";

export type EditorView = "code" | "blocks";

export interface CodePanelOptions {
  initialCode: string;
  onRun(code: string): void;
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
      if (this.edited && this.editor.value.trim() && this.editor.value !== ex.code && !this.confirmReplace("code")) return;
      this.editor.value = ex.code;
      this.edited = false;
      this.setStatus(`Loaded the "${ex.name}" example. Press Run to try it.`);
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
    this.editor.addEventListener("input", () => (this.edited = true));
    // Ctrl/Cmd+Enter runs, like many code playgrounds.
    this.editor.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.runBtn.click();
      }
    });
    const help = el(
      "p",
      { id: helpId, className: "b-detail c-help" },
      "Use ",
      el("code", {}, "robot.setWheels(left, right)"),
      " (−1 to 1), ",
      el("code", {}, 'robot.read("distance")'),
      " and ",
      el("code", {}, "robot.time"),
      ". Code in ",
      el("code", {}, "function loop()"),
      " runs 50 times a second. Ctrl+Enter runs.",
    );

    // ---- Run / stop ----------------------------------------------------------
    this.runBtn = el("button", { type: "button", className: "c-run" }, "Run");
    this.stopBtn = el("button", { type: "button", className: "c-stop", disabled: true }, "Stop");
    this.runBtn.addEventListener("click", () => {
      // Blockly reports changes a moment later; take the blocks' latest code now.
      if (this.view === "blocks" && this.blocks) this.fromBlocks(this.blocks.code());
      opts.onRun(this.editor.value);
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
    this.codeParts = [editorLabel, this.editor, help];
    this.blocksParts = [this.blocksBox, blocksHelp];
    for (const p of this.blocksParts) p.hidden = true;

    root.append(
      exampleRow,
      viewSwitch,
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
    if (view === this.view) return;
    if (view === "code") {
      this.view = "code";
      this.showView();
      this.setStatus("Code view: this is the program your blocks make.");
      return;
    }
    const edits = this.edited && this.editor.value.trim() !== "" && this.editor.value !== this.blocksCode;
    if (edits && !window.confirm("Switch to blocks? Blocks can't be made from code, so your code changes will be replaced by the blocks' program.")) {
      return;
    }
    const blocks = await this.loadBlocks();
    if (!blocks) return;
    this.view = "blocks";
    this.showView();
    blocks.resize();
    this.fromBlocks(blocks.code());
    this.setStatus("Blocks view. Drag blocks in, then press Run.");
  }

  private loadBlocks(): Promise<BlocksEditor | null> {
    if (this.blocks) return Promise.resolve(this.blocks);
    if (this.blocksLoading) return this.blocksLoading;
    this.setStatus("Loading blocks…");
    this.viewButtons.blocks.setAttribute("aria-busy", "true");
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
        this.setStatus("The blocks couldn't load. Check your internet connection and try again.");
        return null;
      })
      .finally(() => {
        this.blocksLoading = null;
        this.viewButtons.blocks.removeAttribute("aria-busy");
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
