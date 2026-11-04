/**
 * The builder panel: start from a template, pick parts, toggle sensors.
 * Every change produces a new RobotSpec and calls `onChange`; the app
 * recompiles and reloads the sim. Built from native form controls (radio
 * groups, checkboxes) so it works with a keyboard and screen readers.
 *
 * DOM only: the editing rules live in ./builderModel.ts (unit-tested).
 */
import type { RobotSpec } from "../robot/spec";
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
   * (the previous robot keeps running), or null on success.
   */
  onChange(spec: RobotSpec): string | null;
}

const PART_LEGENDS: Record<PartField, string> = { chassis: "Chassis", wheels: "Wheels", motor: "Motors" };

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
  private readonly nameInput: HTMLInputElement;
  private readonly nameError: HTMLElement;
  private readonly colorInput: HTMLInputElement;
  private readonly errorBox: HTMLElement;
  private readonly status: HTMLElement;
  private readonly radios = new Map<PartField, HTMLInputElement[]>();
  private readonly sensorBoxes: HTMLInputElement[] = [];

  constructor(
    form: HTMLFormElement,
    private readonly opts: BuilderOptions,
  ) {
    this.current = structuredClone(opts.initial);
    form.noValidate = true;
    form.addEventListener("submit", (e) => e.preventDefault());

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
      btn.addEventListener("click", () => this.apply(templateSpec(t.id), `Started from ${t.spec.name}.`));
      templates.append(btn);
    }

    // ---- Name and colour ---------------------------------------------------
    const nameId = `b-name-${++uid}`;
    const nameErrId = `${nameId}-error`;
    this.nameInput = el("input", { id: nameId, type: "text", autocomplete: "off", spellcheck: false });
    this.nameInput.setAttribute("aria-describedby", nameErrId);
    this.nameError = el("p", { id: nameErrId, className: "b-field-error" });
    this.nameError.hidden = true;
    // Show name problems while typing; rebuild when the edit is committed.
    this.nameInput.addEventListener("input", () => this.showErrors(withName(this.current, this.nameInput.value)));
    this.nameInput.addEventListener("change", () => this.apply(withName(this.current, this.nameInput.value), "Renamed."));

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
    this.status.setAttribute("aria-live", "polite");
    this.status.dataset.testid = "builder-status";

    form.append(templates, nameRow, this.nameError, ...partSets, sensors, this.errorBox, this.status);
    this.sync();
  }

  /** The spec the panel currently shows (last valid one built). */
  get spec(): RobotSpec {
    return structuredClone(this.current);
  }

  /** Try a new spec: show errors inline, or build it. */
  private apply(next: RobotSpec, said: string): void {
    if (!this.showErrors(next)) {
      // Keep what the user typed so they can fix it; other controls stay as built.
      return;
    }
    const failure = this.opts.onChange(next);
    if (failure) {
      this.showOther([failure]);
      this.sync();
      return;
    }
    this.current = structuredClone(next);
    this.sync();
    this.status.textContent = said;
  }

  /** Show validation errors for `spec`; returns true when there are none. */
  private showErrors(spec: RobotSpec): boolean {
    const errs = builderErrors(spec);
    const nameMsg = errs.name.join(" ");
    this.nameError.textContent = nameMsg;
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
  private sync(): void {
    const s = this.current;
    if (document.activeElement !== this.nameInput || this.nameInput.getAttribute("aria-invalid") !== "true") {
      this.nameInput.value = s.name;
    }
    this.colorInput.value = s.color ?? "#3366cc";
    for (const [field, inputs] of this.radios) for (const i of inputs) i.checked = i.value === s[field];
    for (const b of this.sensorBoxes) b.checked = (s.sensors as string[]).includes(b.value);
  }
}
