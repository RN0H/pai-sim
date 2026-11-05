/**
 * The code panel: write a controller program (or load an example), run it,
 * stop it, and see its errors and console output. The program itself runs
 * in a Web Worker (src/control/); this file is DOM only.
 *
 * The editor is a plain <textarea>: it works with screen readers, phone
 * keyboards and copy/paste everywhere, and costs nothing to load. Tab keeps
 * moving focus (it doesn't insert spaces), so keyboard users never get stuck.
 */
import { formatProgramError, type ProgramError } from "../control/api";
import { EXAMPLES, findExample } from "../control/examples";

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
  /** The user has typed since the last example was loaded. */
  private edited = false;

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
      if (this.edited && this.editor.value.trim() && this.editor.value !== ex.code && !this.confirmReplace()) return;
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
    this.runBtn.addEventListener("click", () => opts.onRun(this.editor.value));
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

    root.append(
      exampleRow,
      el("label", { htmlFor: editorId, className: "c-label" }, "Program"),
      this.editor,
      help,
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

  private confirmReplace(): boolean {
    // Plain confirm(): accessible everywhere, and losing code by accident is worse.
    return window.confirm("Replace your code with this example?");
  }

  /** Focus the editor with line `line` (1-based) selected. */
  private selectLine(line: number | null): void {
    if (line === null) return;
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
