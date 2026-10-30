# Building a custom visualization

A custom visualization is one JavaScript file that adds a chart type to Metabase. An admin uploads it in
**Admin → Settings → Custom visualizations**; after that, everyone can pick it in the visualization picker of a
question, and it renders in dashboard cards like the built-in charts.

[`examples/progress-ring.js`](examples/progress-ring.js) is a complete, dependency-free example (a KPI progress
ring). Upload it as it is to try the feature, or copy it to start your own.

> **Security.** A bundle runs as trusted code in the Metabase origin, in the browser of everyone who views a question
> or dashboard that uses it, with that person's access. Only admins can install bundles. Only install code you trust.

## The bundle

A bundle is a single classic script (not an ES module): no `import` or `export` statements, no other files. Use a
bundler to inline any libraries you need (see [Using libraries and React](#using-libraries-and-react)). Bundles can be
up to 5 MB.

It has two parts:

1. **A manifest comment**, first in the file (only whitespace and other comments may come before it). It is a JSON
   object inside a `/* metabase-custom-viz ... */` comment; `/*! metabase-custom-viz ... */` also works, which
   minifiers keep.
2. **A call to `window.MetabaseCustomViz.define(identifier, definition)`** that registers how to render it.

```js
/* metabase-custom-viz
{
  "apiVersion": 1,
  "identifier": "hello-viz",
  "name": "Hello",
  "icon": "bar"
}
*/
(function () {
  window.MetabaseCustomViz.define("hello-viz", {
    mount(container, props) {
      container.textContent = `${props.data.rows.length} rows`;
      return {
        update(nextProps) {
          container.textContent = `${nextProps.data.rows.length} rows`;
        },
        unmount() {
          container.replaceChildren();
        },
      };
    },
  });
})();
```

Metabase validates the manifest and checks that the file parses as JavaScript when it is uploaded, and shows what
is wrong otherwise.

## The manifest

| Key | Required | Description |
|---|---|---|
| `apiVersion` | yes | The version of this contract. Must be `1`. |
| `identifier` | yes | 1–64 lowercase letters, digits or hyphens, starting with a letter. Questions store the visualization as `custom:<identifier>`, so it can't change once the visualization is in use; replacing a bundle keeps it. |
| `name` | yes | Shown in the visualization picker. |
| `icon` | no | The name of a Metabase icon, e.g. `bar`, `pie`, `progress`, `table`. Defaults to a generic chart icon. |
| `description` | no | Up to 1000 characters, for admins. |
| `data` | no | Which query results the visualization can render, see below. |
| `settings` | no | Up to 50 settings shown in the visualization settings sidebar, see below. |

Unknown keys are rejected, which catches typos.

### `data`: what the visualization can render

```json
"data": {
  "minRows": 1,
  "maxRows": 1,
  "minColumns": 1,
  "maxColumns": 5,
  "requiredColumnTypes": { "number": 1, "date": 0, "string": 0, "boolean": 0 }
}
```

All keys are optional. `requiredColumnTypes` asks for at least that many columns of each type. When a result doesn't
fit, the card explains why instead of rendering the plugin.

### `settings`: what people can configure

Each setting has an `id` (letters, digits, `_` or `-`, unique), a `type`, a `title`, and optionally a `section` (the
settings tab it appears in; defaults to "Display"). Values are saved with the question or dashboard card.

| `type` | Widget | Extra keys | Value the plugin gets |
|---|---|---|---|
| `text` | text input | `default`, `placeholder` | string or `undefined` |
| `number` | number input | `default`, `placeholder` | number or `undefined` |
| `select` | dropdown | `options` (`[{ "name": "Thin", "value": "thin" }]`), `default` (one of the values) | the chosen value; the first option by default |
| `toggle` | switch | `default` | boolean; `false` by default |
| `color` | color picker | `default` (a CSS color) | a color; the first accent color by default |
| `column` | column picker | `columnType`: `any` (default), `number`, `string`, `date`, `boolean` | the name of a column of that type; the first one by default |
| `columns` | multi-column picker | `columnType` | an array of column names; all columns of that type by default |

Every visualization also gets Metabase's standard "Formatting" settings for its columns, which `formatValue`
applies.

## Rendering: `define(identifier, { mount })`

`identifier` must be the one in the manifest. `mount(container, props)` renders into `container`, an empty `<div>`
that fills the card, and may return an object with two optional methods:

- `update(props)`: called with new props whenever the data, settings, size or theme change. Without it, Metabase
  calls `unmount`, empties the container and calls `mount` again.
- `unmount()`: called before the card goes away or the visualization is replaced. Remove timers and listeners
  you added outside `container` here. Metabase empties the container afterwards.

`props` contains:

| Prop | Description |
|---|---|
| `apiVersion` | `1`. |
| `data.cols` | The result columns: `{ name, displayName, type, baseType, semanticType }`, where `type` is `number`, `string`, `date`, `boolean` or `other`. |
| `data.rows` | The result rows, arrays of values in column order. Don't modify them. |
| `settings` | The values of your settings, by setting `id`, with defaults applied. |
| `width`, `height` | The size of the card in pixels. |
| `theme` | `{ colorScheme: "light" \| "dark", fontFamily, colors: { brand, textPrimary, textSecondary, background, border, accents } }`, following the instance's theme and branding. |
| `isDashboard`, `isEditing` | Whether the visualization is in a dashboard card, and whether that dashboard is being edited. |
| `formatValue(value, columnName)` | Formats a value the way Metabase formats that column (numbers, dates, currencies, the column's formatting settings). |
| `onClick` | `null`, or a function to call when someone clicks a value: `onClick({ rowIndex, columnName, event })`. It opens Metabase's drill-through menu for that cell (filter by this value, zoom in, see the underlying records, …). Pass the DOM `MouseEvent` as `event` so the menu appears where the click happened, or an `element` to anchor it to. |

Errors your code throws in `mount`, `update` or `unmount` are caught and shown in the card instead of the chart;
they never break the rest of the page.

## Using libraries and React

The bundle runs in the page, so it can use any rendering library, including its own copy of React. Bundle
everything into one IIFE script and put the manifest in a banner, e.g. with [esbuild](https://esbuild.github.io):

```sh
esbuild src/index.jsx --bundle --minify --format=iife --target=es2020 \
  --banner:js="$(cat manifest-comment.js)" --outfile=dist/my-viz.js
```

A React-based `mount` could look like this:

```jsx
import { createRoot } from "react-dom/client";
import { MyChart } from "./MyChart";

window.MetabaseCustomViz.define("my-viz", {
  mount(container, props) {
    const root = createRoot(container);
    root.render(<MyChart {...props} />);
    return {
      update: (nextProps) => root.render(<MyChart {...nextProps} />),
      unmount: () => root.unmount(),
    };
  },
});
```

Keep the bundle self-contained: the content security policy only lets the page load scripts from Metabase itself,
and the bundle should not fetch code or data from elsewhere.

## Where custom visualizations don't render

Subscriptions, alerts and other images rendered on the server can't run plugin JavaScript, so they show a custom
visualization's results as a table. Public links and static embeds aren't signed in, so they can't load bundles and
show a table too.

## Replacing, disabling and deleting

- **Replace bundle** uploads a new version. It must declare the same `identifier`. Browsers cache each bundle by its
  content hash, so everyone gets the new version on their next page load.
- **Disable** hides the visualization from the picker; questions that use it show a table until it's enabled again.
- **Delete** removes it; questions that use it show a table. Installing a bundle with the same identifier later
  brings them back, with their saved settings.
- An admin can turn custom visualizations off entirely on the same page.
