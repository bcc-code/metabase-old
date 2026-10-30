# Custom visualizations

Admin → Settings → Custom visualizations: upload a visualization bundle (a single JavaScript file, max 5 MB), then
enable, disable, replace or delete it. Enabled visualizations appear in the visualization picker for questions and
dashboard cards, with their own settings in the settings sidebar and normal drill-through.

For developers: the plugin contract (version 1) and a step-by-step guide are in
[Building a custom visualization](../development/custom-visualizations.md); a ready-to-upload example is
`frontend/src/metabase/fork/custom-viz/examples/progress-ring.js` in the repository.

**Security:** a bundle runs as trusted code inside Metabase, with the permissions of whoever views it. Only admins
can install bundles; only install code you trust.

Limitations: subscriptions, alerts, public links and static embeds show these cards as a table; the embedding SDK
and the visualizer don't support them; bundles are not part of Git sync.
