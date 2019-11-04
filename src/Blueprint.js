import settings from "./settings";
import templates from "./templates";
import Point from "./point";
import Pointers from "./pointers";
import { setStyle, setAttribute, setTransform } from "./dom";

// Unique ID; Incremented each time a Blueprint class is instanciated.
let uid = 0;

// Firefox detection
const isFirefox = !!navigator.userAgent.match(/firefox/i);

/**
 * Get and check parent Element from settings object.
 *
 * @param  {object}  params
 * @param  {Element} params.parentElement
 * @param  {string}  params.parentSelector
 * @return {Element}
 * @throws {Error}
 */
function getParent({ parentElement, parentSelector }) {
  let parent = null;

  if (parentElement !== null) {
    if (!(parentElement instanceof Element)) {
      throw new Error("Option { parentElement } must be of type Element.");
    }

    return parentElement;
  }

  parent = document.querySelector(parentSelector);

  if (!parent) {
    throw new Error(`No parent found with the selector [ ${parentSelector} ]`);
  }

  return parent;
}

/**
 * Blueprint class.
 */
class Blueprint {
  /**
   * Blueprint constructor.
   *
   * @param {object} [options={}]
   */
  constructor(options = {}) {
    /** @type {int} Unique ID. */
    this.uid = uid++;

    /** @type {object} Local settings. */
    this.settings = { ...settings, ...options };

    /** @type {Element} Parent DOM Element. */
    this.parent = getParent(this.settings);

    /** @type {object} Collection of DOM Elements. */
    this.elements = templates.blueprint({ ...this.settings, uid });

    /** @type {Point} Current position. */
    this.position = new Point(0, 0);

    /** @type {Point} Cursor position. */
    this.cursor = new Point(0, 0);

    /** @type {float} Current scale factor. */
    this.scale = 1;

    /** @type {int} Grid size. */
    this.gridSize = 100;

    /** @type {Pointers} Pointers instance. */
    this.pointers = new Pointers(this.parent);

    // append the blueprint element to parent element
    this.parent.appendChild(this.elements.blueprint);

    // pan
    let panId = null;

    this.pointers.on("pan.start", event => {
      if (panId !== null) return;
      panId = event.data.id;
      this.pan(event.data.panOffsets);
      this.updateCursorPosition({ position: event.data.position, show: true });
    });

    this.pointers.on("pan.move", event => {
      if (panId !== event.data.id) return;
      this.pan(event.data.movement);
      this.updateCursorPosition({ position: event.data.position, show: true });
    });

    this.pointers.on("pan.end", event => {
      if (panId !== event.data.id) return;
      this.hide("cursor");
      panId = null;
    });

    // mouse wheel
    this.pointers.on("wheel.start", event => {
      this.updateCursorPosition({ position: event.data.position, show: true });
    });

    this.pointers.on("wheel.move", event => {
      this.zoom(event.data.delta, event.data.position);
      this.updateCursorPosition({ position: event.data.position, show: true });
    });

    this.pointers.on("wheel.end", () => {
      this.hide("cursor");
    });
  }

  show(what, display = true) {
    if (!Array.isArray(what)) {
      what = what.split(/[\s,]+/);
    }

    what.forEach(key => {
      if (this.elements[key]) {
        setStyle(this.elements[key], "display", display ? null : "none");
      }
    });
  }

  hide(what, hide = true) {
    this.show(what, !hide);
  }

  redraw() {
    // translate axis
    setTransform(this.elements.axisX, "translate", [0, -this.position.y]);
    setTransform(this.elements.axisY, "translate", [-this.position.x, 0]);

    // translate cursor
    setTransform(this.elements.cursorX, "translate", [0, this.cursor.y]);
    setTransform(this.elements.cursorY, "translate", [this.cursor.x, 0]);

    // translate grid
    setAttribute(
      this.elements.gridPattern,
      "patternTransform",
      `translate(${-this.position.x}, ${-this.position.y})`
    );

    // scale grid
    const gridSize = { width: this.gridSize, height: this.gridSize };
    const gridPath = `M ${this.gridSize} 0 L 0 0 0 ${this.gridSize}`;

    setAttribute(this.elements.gridFill10, gridSize);
    setAttribute(this.elements.gridFill100, gridSize);
    setAttribute(this.elements.gridPattern, gridSize);
    setAttribute(this.elements.gridPattern10, "d", gridPath);
    setAttribute(this.elements.gridPattern100, "d", gridPath);

    // scale stroke width
    if (this.settings.nonScalingStroke === true) {
      const strokeWidth = this.settings.strokeWidth / this.scale;
      setStyle(this.elements.workspace, "stroke-width", strokeWidth);
    }

    // translate workspace
    setAttribute(this.elements.workspace, "viewBox", [
      this.position.x / this.scale,
      this.position.y / this.scale,
      1 / this.scale,
      1 / this.scale
    ]);

    // Force redraw to fix blurry lines
    if (isFirefox) {
      const clone = this.elements.workspace.cloneNode(true);
      this.elements.canvas.replaceChild(clone, this.elements.workspace);
      this.elements.workspace = clone;
    }
  }

  /**
   * Update the cursor position.
   *
   * @param {object} [options={}]
   * @param {Point}  options.position
   * @param {bool}   [options.show=false]
   */
  updateCursorPosition({ position, show = false } = {}) {
    this.cursor = new Point(position);
    this.show("cursor", show);
    this.redraw();
  }

  move(point) {
    this.position = new Point(point);

    this.redraw();
  }

  pan(point) {
    this.position = this.position.sub(point);

    this.redraw();
  }

  zoom(delta, target = null) {
    // old scale
    const oldScale = this.scale;

    // zoom direction
    delta *= this.settings.zoomDirection;

    // scale by delta x zoomFactor
    this.scale += delta * this.settings.zoomFactor * this.scale;

    // zoom limit
    if (this.scale < this.settings.zoomLimit.min) {
      this.scale = this.settings.zoomLimit.min;
    } else if (this.scale > this.settings.zoomLimit.max) {
      this.scale = this.settings.zoomLimit.max;
    }

    // (calculate) new grid size
    let gridSize = this.scale
      .toString()
      .replace(".", "")
      .replace(/e.*/, "")
      .replace(/^0+/, "")
      .replace(/^([1-9])/, "$1.");
    this.gridSize = parseFloat(gridSize) * 100;

    // target point, default to center of workspace
    target = target ? new Point(target) : this.getWorkspaceCenter();

    // mouse coordinates at current scale
    const coords = target.div(oldScale).add(this.position.div(oldScale));

    // new position
    this.position = new Point(
      coords.x * this.scale - target.x,
      coords.y * this.scale - target.y
    );

    this.redraw();
  }
}

export default Blueprint;
