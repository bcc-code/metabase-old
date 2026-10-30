/* metabase-custom-viz
{
  "apiVersion": 1,
  "identifier": "progress-ring",
  "name": "Progress ring",
  "icon": "progress",
  "description": "Shows a number as a ring that fills up toward a goal.",
  "data": {
    "minRows": 1,
    "requiredColumnTypes": { "number": 1 }
  },
  "settings": [
    {
      "id": "value",
      "type": "column",
      "title": "Value",
      "columnType": "number",
      "section": "Data"
    },
    {
      "id": "goal",
      "type": "number",
      "title": "Goal",
      "default": 100,
      "section": "Data"
    },
    {
      "id": "label",
      "type": "text",
      "title": "Label",
      "placeholder": "Shown under the number"
    },
    { "id": "color", "type": "color", "title": "Ring color" },
    {
      "id": "thickness",
      "type": "select",
      "title": "Ring thickness",
      "options": [
        { "name": "Thin", "value": "thin" },
        { "name": "Regular", "value": "regular" },
        { "name": "Thick", "value": "thick" }
      ],
      "default": "regular"
    },
    {
      "id": "showGoal",
      "type": "toggle",
      "title": "Show the goal",
      "default": true
    }
  ]
}
*/

// An example custom visualization for Metabase: a KPI progress ring.
// It has no dependencies and can be uploaded as it is in
// Admin > Settings > Custom visualizations. See README.md next to it.
(function () {
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const RING_THICKNESS = { thin: 0.06, regular: 0.1, thick: 0.16 };
  // Height of each line of text under the ring, and the padding around it all.
  const LINE_HEIGHT = 20;
  const PADDING = 8;

  function createSvgElement(name, attributes) {
    const element = document.createElementNS(SVG_NAMESPACE, name);
    Object.entries(attributes).forEach(([attribute, value]) => {
      element.setAttribute(attribute, String(value));
    });
    return element;
  }

  function createText(text, style) {
    const element = document.createElement("div");
    element.textContent = text;
    Object.assign(element.style, style);
    return element;
  }

  function render(container, props) {
    const { data, settings, theme, width, height } = props;
    const columnIndex = data.cols.findIndex(
      (column) => column.name === settings.value,
    );
    const value = columnIndex >= 0 ? Number(data.rows[0][columnIndex]) : NaN;
    const goal = Number(settings.goal);
    const ratio =
      Number.isFinite(value) && goal > 0
        ? Math.max(0, Math.min(1, value / goal))
        : 0;

    // The number sits inside the ring; only the label and goal lines go under it.
    const linesBelow = (settings.label ? 1 : 0) + (settings.showGoal ? 1 : 0);
    const size = Math.max(
      40,
      Math.min(width, height - linesBelow * LINE_HEIGHT) - 2 * PADDING,
    );
    const strokeWidth =
      size * (RING_THICKNESS[settings.thickness] || RING_THICKNESS.regular);
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const ringColor = settings.color || theme.colors.brand;

    const root = document.createElement("div");
    Object.assign(root.style, {
      height: "100%",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "2px",
      boxSizing: "border-box",
      padding: `${PADDING}px`,
      fontFamily: theme.fontFamily,
      color: theme.colors.textPrimary,
      cursor: props.onClick ? "pointer" : "default",
    });

    const ring = createSvgElement("svg", {
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      role: "img",
      "aria-label": `${Math.round(ratio * 100)}%`,
    });
    const circleAttributes = {
      cx: size / 2,
      cy: size / 2,
      r: radius,
      fill: "none",
      "stroke-width": strokeWidth,
    };
    ring.appendChild(
      createSvgElement("circle", {
        ...circleAttributes,
        stroke: theme.colors.border,
      }),
    );
    ring.appendChild(
      createSvgElement("circle", {
        ...circleAttributes,
        stroke: ringColor,
        "stroke-linecap": "round",
        "stroke-dasharray": `${circumference * ratio} ${circumference}`,
        transform: `rotate(-90 ${size / 2} ${size / 2})`,
      }),
    );
    const ringWithValue = document.createElement("div");
    Object.assign(ringWithValue.style, {
      position: "relative",
      width: `${size}px`,
      height: `${size}px`,
    });
    ringWithValue.appendChild(ring);
    ringWithValue.appendChild(
      createText(
        columnIndex >= 0 ? props.formatValue(value, settings.value) : "",
        {
          position: "absolute",
          inset: "0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: `${Math.max(12, Math.round((size - 2 * strokeWidth) / 5))}px`,
          fontWeight: "bold",
          whiteSpace: "nowrap",
        },
      ),
    );
    root.appendChild(ringWithValue);
    if (settings.label) {
      root.appendChild(
        createText(settings.label, {
          color: theme.colors.textSecondary,
          lineHeight: `${LINE_HEIGHT}px`,
        }),
      );
    }
    if (settings.showGoal) {
      root.appendChild(
        createText(`${Math.round(ratio * 100)}% of ${goal}`, {
          color: theme.colors.textSecondary,
          fontSize: "12px",
          lineHeight: `${LINE_HEIGHT}px`,
        }),
      );
    }

    if (props.onClick && columnIndex >= 0) {
      root.addEventListener("click", (event) => {
        props.onClick({ rowIndex: 0, columnName: settings.value, event });
      });
    }

    container.replaceChildren(root);
  }

  window.MetabaseCustomViz.define("progress-ring", {
    mount(container, props) {
      render(container, props);
      return {
        update(nextProps) {
          render(container, nextProps);
        },
        unmount() {
          container.replaceChildren();
        },
      };
    },
  });
})();
