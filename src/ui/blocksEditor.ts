/**
 * The Blockly workspace in the code panel. Loaded lazily (dynamic import)
 * the first time someone opens the Blocks view, so Blockly's ~800 KB never
 * slows down the first page load. The blocks themselves, the toolbox and the
 * code generator are in src/control/blocks.ts.
 */
import * as Blockly from "blockly/core";
import {
  BLOCK_EXAMPLES,
  registerRobotBlocks,
  STARTER_BLOCKS,
  TOOLBOX,
  workspaceToProgram,
  type BlocksJson,
} from "../control/blocks";

export interface BlocksEditorOptions {
  /** What the workspace starts with (default: the starter blocks). */
  initial?: BlocksJson;
  /** Called with the generated program whenever the blocks change. */
  onChange(code: string): void;
}

export class BlocksEditor {
  private readonly ws: Blockly.WorkspaceSvg;
  private readonly resizer: ResizeObserver | null;
  /** The user changed the blocks since they were last loaded. */
  edited = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: BlocksEditorOptions,
  ) {
    registerRobotBlocks();
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    this.ws = Blockly.inject(container, {
      toolbox: TOOLBOX,
      // Served with the site: Blockly would otherwise fetch them from a CDN.
      media: `${import.meta.env.BASE_URL}blockly-media/`,
      sounds: false,
      trashcan: true,
      renderer: "geras",
      theme: Blockly.Themes.Classic,
      zoom: { controls: true, wheel: false, pinch: true, startScale: coarse ? 0.7 : 0.8, maxScale: 2, minScale: 0.4 },
      move: { scrollbars: true, drag: true, wheel: true },
    });
    // Blockly puts its menus (dropdowns, text fields) at the end of <body>:
    // arrow keys there move through the menu, they mustn't drive the robot.
    for (const div of document.querySelectorAll(".blocklyWidgetDiv, .blocklyDropDownDiv")) {
      div.setAttribute("data-no-drive", "");
    }
    this.load(opts.initial ?? STARTER_BLOCKS);
    this.ws.addChangeListener((e) => {
      if (e.isUiEvent) return;
      // Loose blocks (outside "when the program starts" / "every tick") don't
      // run: grey them out so that's visible.
      Blockly.Events.disableOrphans(e);
      this.edited = true;
      this.emit();
    });
    // Blockly sizes itself once; follow the panel as it opens, closes and resizes.
    this.resizer = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.resize()) : null;
    this.resizer?.observe(container);
  }

  /** Replace the blocks (an example or a fresh start). Not counted as an edit. */
  load(json: BlocksJson): void {
    Blockly.Events.disable();
    try {
      Blockly.serialization.workspaces.load(json, this.ws);
    } finally {
      Blockly.Events.enable();
    }
    // Show the top-left of the program (where the hats start), not its middle.
    this.ws.scroll(0, 0);
    this.edited = false;
    this.emit();
  }

  /**
   * Load blocks from somewhere untrusted (a share link). If Blockly rejects
   * them, the starter blocks are loaded instead and false is returned.
   */
  tryLoad(json: BlocksJson): boolean {
    try {
      this.load(json);
      return true;
    } catch {
      this.load(STARTER_BLOCKS);
      return false;
    }
  }

  /** Load the block version of an example program (src/control/examples.ts ids). */
  loadExample(id: string): boolean {
    const json = BLOCK_EXAMPLES[id];
    if (!json) return false;
    this.load(json);
    return true;
  }

  save(): BlocksJson {
    return Blockly.serialization.workspaces.save(this.ws);
  }

  /** The program the blocks make. */
  code(): string {
    return workspaceToProgram(this.ws);
  }

  /** Close open menus, field editors and the toolbox flyout. */
  hidePopups(): void {
    Blockly.hideChaff();
    Blockly.WidgetDiv.hide();
    Blockly.DropDownDiv.hideWithoutAnimation();
  }

  resize(): void {
    if (this.container.offsetWidth > 0) Blockly.svgResize(this.ws);
  }

  dispose(): void {
    this.resizer?.disconnect();
    this.ws.dispose();
  }

  private emit(): void {
    this.opts.onChange(this.code());
  }
}
