# White-labeling

Admin → Settings → Appearance:

- **Branding**: **Use BCC theme** (BCC Design System: BCC green `#014D49`, its categorical chart hues, and the Archivo
  typeface, which this fork bundles), application name, logo and
  favicon upload, brand / filter / summarize / chart colors, font (bundled, web-safe, or your own font files),
  loading message, and the login, home, "no results" and "nothing found" illustrations.
- **Conceal Metabase**: help link (Metabase, hidden, or your own URL), hide Metabase links and the "Powered by
  Metabase" badge, Metabot greeting.

Branding applies across the app, public links and static embeds, emails, Slack messages and PDF exports ("Made with
Metabase" is gone everywhere). Dark mode lightens a too-dark brand color so text stays readable. The BCC theme takes
its values from the BCC Design System: purple-700 and orange-700 for the query builder's filter and summarize steps
(both readable with white text), and chart colors that avoid red, green and yellow, which the design system reserves
for danger, success and warning.

Tips: upload the logo as PNG or JPEG (email clients can't show SVG logos). To make the BCC look the default at
deploy time instead of clicking the button (values from `frontend/src/metabase/fork/whitelabel/bcc-theme.ts`):

```bash
MB_APPLICATION_FONT=Archivo
MB_APPLICATION_COLORS='{"brand":"#014D49","filter":"#61479C","summarize":"#943A14","accent0":"#1D7F78","accent1":"#9A82DA","accent2":"#DA772E","accent3":"#1A9EB7","accent4":"#DE66B0","accent5":"#A98C66","accent6":"#608EF6","accent7":"#BC870D"}'
```
