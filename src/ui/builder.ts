/**
 * The builder panel: start from a template, pick parts, toggle sensors.
 * Every change produces a new RobotSpec and calls `onChange`; the app
 * recompiles and reloads the sim. Built from native form controls (radio
 * groups, checkboxes) so it works with a keyboard and screen readers.
 *
 * DOM only: the editing rules live in ./builderModel.ts (unit-tested).
 */
import { cloneSpec, type RobotSpec } from "../robot/spec";
import { TEMPLATES, templateSpec } from "../robot/templates";
import {
  builderErrors,
  partOptions,
  sensorOptions,
  withColor,
  withName,
  withPart,
  withSensor,
  type PartField,
} from "./builderModel";

export interface BuilderOptions {
  initial: RobotSpec;
  /**
   * A valid spec to build. Return an error message if it couldn't be loaded
   * (the previous scene keeps running), or null on success.
   */
  onChange(spec: RobotSpec): string | null;
}

const PART_LEGENDS: Record<PartField, string> = { chassis: "Chassis", wheels: "Wheels", motor: "Motors" };
const DEFAULT_COLOR = "#3366cc";

let uid = 0;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

export class BuilderPanel {
  private current: RobotSpec;
  /** Whether the sim is running this panel's robot (vs. another scene). */
  private showing = false;
  private readonly nameInput: HTMLInputElement;
  private readonly nameError: HTMLElement;
  private readonly colorInput: HTMLInputElement;
  private readonly errorBox: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly status: HTMLElement;
  private readonly radios = new Map<PartField, HTMLInputElement[]>();
  private readonly sensorBoxes: HTMLInputElement[] = [];

  constructor(
    form: HTMLFormElement,
    private readonly opts: BuilderOptions,
  ) {
    this.current = cloneSpec(opts.initial);
    form.noValidate = true;
    form.addEventListener("submit", (e) => e.preventDefault());

    // ---- Not-showing notice ------------------------------------------------
    const showBtn = el("button", { type: "button", className: "b-show" }, "Show my robot");
    showBtn.addEventListener("click", () => this.apply(this.current, `${this.current.name} is in the scene.`));
    this.notice = el("p", { className: "b-notice" }, "Another scene is running. ", showBtn);
    this.notice.hidden = true;

    // ---- Templates ---------------------------------------------------------
    const templates = el("fieldset", { className: "b-templates" }, el("legend", {}, "Start from a template"));
    for (const t of TEMPLATES) {
      const btn = el(
        "button",
        { type: "button", className: "b-template" },
        el("span", { className: "b-template-name" }, t.spec.name),
        el("span", { className: "b-detail" }, t.blurb),
      );
      btn.dataset.template = t.id;
      btn.addEventListener("click", () => this.apply(templateSpec(t.id), `Started from ${t.spec.name}.`, true));
      templates.append(btn);
    }

    // ---- Name and colour ---------------------------------------------------
    const nameId = `b-name-${++uid}`;
    const nameErrId = `${nameId}-error`;
    this.nameInput = el("input", { id: nameId, type: "text", autocomplete: "off", spellcheck: false });
    this.nameInput.setAttribute("aria-describedby", nameErrId);
    this.nameError = el("p", { id: nameErrId, className: "b-field-error" });
    // Announced when the message changes (not on every keystroke).
    this.nameError.setAttribute("aria-live", "polite");
    this.nameError.hidden = true;
    // Show name problems while typing; rebuild when the edit is committed.
    this.nameInput.addEventListener("input", () => this.showErrors(this.pending()));
    this.nameInput.addEventListener("change", () => this.apply(this.pending(), "Renamed.", true));

    const colorId = `b-color-${++uid}`;
    this.colorInput = el("input", { id: colorId, type: "color" });
    this.colorInput.addEventListener("change", () => this.apply(withColor(this.current, this.colorInput.value), "Repainted."));

    const nameRow = el(
      "div",
      { className: "b-row" },
      el("div", { className: "b-name" }, el("label", { htmlFor: nameId }, "Name"), this.nameInput),
      el("div", { className: "b-color" }, el("label", { htmlFor: colorId }, "Colour"), this.colorInput),
    );

    // ---- Parts -------------------------------------------------------------
    const partSets = (["chassis", "wheels", "motor"] as const).map((field) => {
      const set = el("fieldset", { className: "b-choices" }, el("legend", {}, PART_LEGENDS[field]));
      const group = `b-${field}-${++uid}`;
      const inputs: HTMLInputElement[] = [];
      for (const o of partOptions(field)) {
        const input = el("input", { type: "radio", name: group, value: o.id });
        input.addEventListener("change", () => {
          if (input.checked) this.apply(withPart(this.current, field, o.id), `${o.label} fitted.`);
        });
        // Clicking the part already fitted fires no "change"; if another scene
        // is running, that click should still bring the robot back.
        input.addEventListener("click", () => {
          if (!this.showing && this.current[field] === o.id) this.apply(this.current, `${o.label} fitted.`);
        });
        inputs.push(input);
        set.append(
          el("label", { className: "b-choice" }, input, el("span", { className: "b-choice-name" }, o.label), el("span", { className: "b-detail" }, o.detail)),
        );
      }
      this.radios.set(field, inputs);
      return set;
    });

    // ---- Sensors -----------------------------------------------------------
    const sensors = el("fieldset", { className: "b-choices" }, el("legend", {}, "Sensors"));
    for (const o of sensorOptions()) {
      const box = el("input", { type: "checkbox", value: o.id });
      box.addEventListener("change", () =>
        this.apply(withSensor(this.current, o.id, box.checked), `${o.label} ${box.checked ? "added" : "removed"}.`),
      );
      this.sensorBoxes.push(box);
      sensors.append(
        el("label", { className: "b-choice" }, box, el("span", { className: "b-choice-name" }, o.label), el("span", { className: "b-detail" }, o.detail)),
      );
    }

    this.errorBox = el("div", { className: "b-errors" });
    this.errorBox.setAttribute("role", "alert");
    this.errorBox.hidden = true;
    this.status = el("p", { className: "visually-hidden" });
    this.status.setAttribute("role", "status");

    form.append(this.notice, templates, nameRow, this.nameError, ...partSets, sensors, this.errorBox, this.status);
    this.sync(true);
  }

  /** The last spec that was built (always valid). */
  get spec(): RobotSpec {
    return cloneSpec(this.current);
  }

  /** The current spec with the name as typed (may be invalid). */
  private pending(): RobotSpec {
    return withName(this.current, this.nameInput.value);
  }

  /** Start over from a template (as if its button was pressed). */
  useTemplate(id: string): void {
    const spec = templateSpec(id);
    this.apply(spec, `Started from ${spec.name}.`, true);
  }

  /**
   * Tell the panel whether the sim is running its robot. When it isn't (the
   * user picked another scene), the panel says so and offers to show it.
   */
  setShowing(showing: boolean): void {
    this.showing = showing;
    this.notice.hidden = showing;
  }

  /**
   * Try a new spec: show errors inline, or build it.
   * `withTypedName`: the change is about the name (or replaces it, like a
   * template), so the Name field follows the result. Otherwise a name the
   * user is still fixing is left in the field, with its error.
   */
  private apply(next: RobotSpec, said: string, withTypedName = false): void {
    const errs = builderErrors(next);
    if (errs.name.length || errs.other.length) {
      this.showErrors(next);
      return;
    }
    const failure = this.opts.onChange(next);
    if (failure) {
      this.showOther([failure]);
      this.sync(false);
      return;
    }
    this.current = cloneSpec(next);
    this.sync(withTypedName);
    this.showErrors(this.pending());
    this.announce(said);
  }

  private announce(text: string): void {
    // Clear first so a repeated message ("Small chassis fitted.") is re-read.
    this.status.textContent = "";
    requestAnimationFrame(() => (this.status.textContent = text));
  }

  /** Show validation errors for `spec`; returns true when there are none. */
  private showErrors(spec: RobotSpec): boolean {
    const errs = builderErrors(spec);
    const nameMsg = errs.name.join(" ");
    if (this.nameError.textContent !== nameMsg) this.nameError.textContent = nameMsg;
    this.nameError.hidden = nameMsg === "";
    this.nameInput.setAttribute("aria-invalid", String(nameMsg !== ""));
    this.showOther(errs.other);
    return errs.name.length === 0 && errs.other.length === 0;
  }

  private showOther(errors: string[]): void {
    this.errorBox.replaceChildren(...(errors.length ? [el("strong", {}, "Can't build this robot yet: "), errors.join(" ")] : []));
    this.errorBox.hidden = errors.length === 0;
  }

  /** Put the controls in line with the current spec. */
  private sync(resetName: boolean): void {
    const s = this.current;
    if (resetName) this.nameInput.value = s.name;
    this.colorInput.value = s.color ?? DEFAULT_COLOR;
    for (const [field, inputs] of this.radios) for (const i of inputs) i.checked = i.value === s[field];
    for (const b of this.sensorBoxes) b.checked = (s.sensors as string[]).includes(b.value);
  }
}
