---
description: "A Background image row in the dsh Web GUI General settings: five built-in backgrounds, an opacity the user sets, and image files this deployment stores and serves to every connected browser."
kind: "package-bundle"
---

# dsh-plugin-ui-background-image

English | [中文](README.zh.md)

## Summary

The Background image row in General settings gives the interface a background. Users pick one of five shipped backgrounds, upload an image of their own, and set how strongly it shows through with one continuous opacity control. The background covers the whole interface, the sidebar column included. A choice applies immediately and persists. The package installs as a profile bundle: `dsh plugin --profile web add dsh-plugin-ui-background-image` adds the row, and removing the package removes it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### Install into a profile

```text
dsh plugin --profile web add dsh-plugin-ui-background-image
dsh plugin --profile web remove dsh-plugin-ui-background-image
```

The package declares `dsh.bundle.patch`, so `add` records it in the profile's `dsh.profile.bundles` and applies its layer, which inserts the `ui-background-image` row into the composition. Restart `dsh web` and the row appears in Settings → General, under Font family.

Installing from npm uses the published artifacts. Installing from a git ref or a source directory builds the package on that machine, and pnpm blocks the build script until the profile's `pnpm-workspace.yaml` allows it; follow the `allowBuilds` line the first attempt prints.

### What you get

- **The Background image row** shows the background in force on the row itself and opens the picker.
- **The picker** offers the five shipped backgrounds — None, Mist, Dusk, Ember, Verdant, each carrying a value for the light and the dark palette — a tile for every image this deployment holds, and a field for an image URL. A tile previews the interface's own compositing: the background under the surface colour at the opacity in force. A pasted URL is answered by the Host's judgement, not by the page's: the row reports the reason it was refused, and nothing is stored until it was accepted.
- **A remote image URL** is loaded by the browser directly and never fetched by the Host, and only after the Host has judged it. Three kinds of rule apply, and only the first is a guarantee: what keeps the stored value well-formed (an absolute URL the document and the canvas can hold) and who may write it at all (the deployment's own request fence); the destination rules the deployment chooses with `remoteImageAccess`, `strict` by default; and the costs that come with loading an image from someone else's host, which are listed under limitations.
- **The opacity control** sets how far the interface's surfaces open, from 0 (the background invisible, and the harness's own colours back exactly) to 100 (the background at its strongest), and applies while the user drags. Releasing writes once.
- **The management dialog** uploads images (`.png` `.jpg` `.jpeg` `.webp` `.gif` `.avif`, 20 MiB each by default), deletes them, and shows the directory the files live in.
- **The background is painted before the page's scripts run**, from the settings document the Host resolves, so a reload never shows the default background first.

![The Background image row in General settings](assets/settings-background-row.png)

![The background picker](assets/background-picker.png)

![An uploaded image behind the interface](assets/background-applied.png)

### Configuration

Fields are optional and belong in the profile's own `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- id: ui-background-image
  config:
    defaultBackground:
      source: preset
      id: mist
      opacity: 80
```

| Field | Default | Meaning |
|---|---|---|
| `imageDir` | `$DSH_HOME/backgrounds` | Directory holding uploaded images. A path set here that cannot be created fails the plugin at load; the default path only logs a warning. |
| `dshHome` | `$DSH_HOME`, then `~/.dsh` | Overrides the harness home this package resolves paths against. |
| `maxUploadBytes` | `20971520` | Largest accepted upload, in bytes. The page refuses a larger file before reading it, using this package's own default until the catalogue has answered. |
| `remoteImageAccess` | `strict` | Destination rules for remote image URLs: `strict` requires `https`, a hostname rather than an address, nothing reserved for local networks, and a name that resolves to public addresses; `any` keeps only the rules that hold the stored value well-formed. |
| `remoteImageHosts` | none | Hostnames a remote image URL may name, each a bare hostname or a `*.suffix` wildcard. Unset places no host restriction of its own; an empty list refuses every remote image. The list applies in both modes. |
| `defaultBackground` | `{ source: preset, id: none, opacity: 65 }` | Background used until a user chooses one, and what "restore default" returns to. |

`defaultBackground.source` is `preset`, `upload`, or `remote`: `id` names a shipped preset or a stored image, and `url` names the `https` image a `remote` selection loads. A user's own choice always wins over it. A value this package cannot act on — a non-integer limit, a preset id this build does not ship, an id the image directory could not hold, an allowlist entry that is not a bare hostname, a remote URL the gate refuses — fails at load rather than at first use.

### Where uploaded images are stored

`$DSH_HOME/backgrounds`, which is `~/.dsh/backgrounds` by default, next to `settings.yaml`. The management dialog shows the path in use.

- One directory to back up, migrate, or delete; nothing is stored in the browser.
- Copying an image into it works without the settings page, and so does deleting one.
- A stored file is named `<name>-<16 hex characters>.<extension>`; the extension follows the bytes, not the uploaded name. A write stages its bytes and renames them into place.
- Images served to a browser come from the machine running `dsh`, so every browser connected to this deployment sees them. The directory path itself is reported only to a browser on that machine.

### Uninstall

```text
dsh plugin --profile web remove dsh-plugin-ui-background-image
```

That removes the row and stops serving the images. Two things stay behind:

- **Uploaded files** in `$DSH_HOME/backgrounds`. Delete that directory to remove them, or keep it and install the package again later.
- **The saved selection** in `$DSH_HOME/settings.yaml` under `ui-background-image`. It is inert without the package and can be deleted with it.

### Backgrounds when the Host runs elsewhere

Every route is registered on the shared API channel `ctx.connection.fetch`, so the deployment's own Host and Origin fence plus browser authentication run before any handler here: a process without the browser credential cannot read the image directory, store a file, or choose a background for the browsers that do have it. Uploaded images are then served to whichever browser reaches the Host — one on another machine can choose one and sees the file, while the directory path is withheld unless the request arrived by a name that means this machine, so copying files in stays a local operation.

A remote image is different in one way that matters: every browser loads it from the third-party host itself, on every page load, so that host learns the browser's address and sees the request in its own logs. The picker's tile asks for it with `referrerpolicy="no-referrer"`, and the canvas request follows whatever referrer policy the page carries, which by default sends only the origin. Nothing is proxied or cached: the Host judges the URL and stores it, and the image stays where it is.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package has a Host half and a browser half, joined by `package.json` (`dsh.client` and the `./client` export). The Host registers the settings section, owns the image directory, answers the HTTP routes, and injects the pre-plugin rows; the browser renders the settings row, its two dialogs, and projects every change onto the document.

| Path | Role |
|---|---|
| `src/index.ts` | Host plugin body: config resolution, the settings section, the index-injection rows, route registration. |
| `src/background-fetch-routes.ts` | Catalogue, image, upload, delete, and remote-approval routes on the shared API channel, which authenticates every one of them before a handler runs. |
| `src/background-remote.ts` | The remote URL policy both halves apply: `https`, no credentials, a hostname rather than an address, nothing local, and the deployment's allowlist. |
| `src/background-remote-approval.ts` | The Host's judgement of what a hostname resolves to, and the record of what it has approved for the first paint. |
| `src/user-backgrounds.ts` | The image directory: storing, listing, reading, and deleting files. |
| `src/background-files.ts` | Container identification from the leading bytes, and the readable part of a stored name. |
| `src/background-canvas.ts`, `src/background-opacity.ts` | The canvas rule, the two token values, and the one mapping from the user's opacity to a surface alpha. |
| `src/background-presets.ts`, `src/background-selection.ts` | The shipped backgrounds and the resolution from a persisted selection to a canvas value. |
| `src/background-settings.ts`, `src/background-settings-schema.ts` | The settings namespace, the stored-id rule, and the schema the Host registers. |
| `src/boot-background.ts` | The pre-plugin rows written into the served page. |
| `src/client/` | The row, picker, management dialog, runtime, and the theme token layer that installs the canvas. |

Three decisions shape the rest. **The image is painted on the body canvas, and the interface's surfaces are made translucent over it**: the plugin owns a stylesheet rule reading its own `--dsh-ui-background-image` variable, and overrides the two official tokens that cover the interface — `--dsw-alias-bg-base` for the surfaces and `--dsw-specific-sidebar-fill` for the sidebar column — with translucent derivations of the palette's own colours. Those values stay valid colours, so every official consumer — `background`, `background-color`, and the fade bands built from `color-mix(...)` — keeps working, and nothing outside those two documented tokens is replaced. **One control sets the strength**: the opacity maps to alphas with a single definition each. The surfaces keep `Math.round(100 - 64 × opacity ÷ 100)`, so 0 leaves them opaque, the default 65 holds them at 58%, and 100 still keeps them at 36% — enough for text over a photograph. The sidebar paints its fill twice, once on the column and once on the element inside it, so its own alpha is `1 - √(openness)`: the value whose square leaves it showing exactly what the conversation area beside it shows, and fully opaque at 0. **The first paint comes from the settings document**, not from a guess: the Host renders the resolved background into the index as a head stylesheet plus a body script that copies the per-mode values onto the same three property names the browser half writes, so the theme presenter's retraction removes them with everything else. **A remote URL is judged before it is stored, and the Host never fetches it**: a background is a request the interface makes on every page load, so a URL the user pastes could otherwise point that request at a service on their own machine or network. The text policy runs in both halves, the public-address judgement runs where resolution lives, and an index render — which cannot await a name lookup — paints a remote URL only once this process has approved it.

`source` and `id` move in one write, because a lone `source` would be validated against the previous `id`. The opacity moves in a write of its own, once per settled drag.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Package and install a plugin](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) — bundles, profiles, and the layer order this package installs into.
- [Add a settings card](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-settings-card.md) — the settings-section and slot registration this row uses.
- [Web styling](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/web-styling.md) — the token and styling rules the installed canvas follows.
- [ui-theme](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/ui-theme) — the theme service whose token layer this package writes through.
- [License](LICENSE) — MIT.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current package constraints; they define what a background cannot change and what this deployment does not do.

- **A background is paint, not layout** — the image is drawn behind the interface on the body canvas and never participates in layout; a background cannot reflow, restyle, or hide anything.
- **Text over a photograph is the user's call** — at 100 the surfaces still hold 36% of the palette's base colour, which keeps body text readable over the shipped backgrounds. A photograph with strong local contrast under a nested card can still make text harder to read, and lowering the opacity is the answer.
- **A theme that ships its own surface or sidebar colour is superseded while a background is installed** — this package overrides `--dsw-alias-bg-base` and `--dsw-specific-sidebar-fill` while it has a background to show, and removes its layer when the selection returns to None.
- **Placement is cover, centred, and fixed** — the image fills the viewport and does not scroll with the document; there is no tiling, no `contain`, and no cropping control.
- **No thumbnails** — a picker tile loads the stored file itself, so a directory of large images costs one full download per tile that scrolls into view. An image this plugin stored is cached immutably after that; a name a user copied into the directory carries the date its bytes were written, so a browser that already has it revalidates and gets a `304` with no body instead of the file again.
- **An animated GIF animates** — and re-rasterizes on every frame, which costs more than a still background.
- **The `theme-color` meta tag reports a translucent colour** — the browser chrome above the page reads the overridden token, so it is the composited colour only where the page's own paint is behind it.
- **Uploads are capped per file, not in total** — `maxUploadBytes` bounds one file; nothing bounds the size of the directory.
- **A crash during a write can leave one `.staging` file** — every read ignores it, it is never served, and it is never listed; delete it by hand if it is in the way.
- **The desktop application has no web server** — the package registers HTTP routes on the shared API channel, so a build without `dsh-host-webserver` and `dsh-client-connection` leaves it pending rather than loading it.
- **A URL check decides the first request, not every request** — `strict` refuses a name that resolves to a private address before storing it, and the browser then resolves that name again when it loads the image, following any redirect the host answers with. A host that answers differently in between, or that redirects to somewhere the policy would have refused, is outside what checking a URL can decide. Making it enforceable means fetching the bytes in the Host instead, which puts those requests on the Host and is why this package does not do it.
- **`any` is the deployment pointing its own browsers** — with `remoteImageAccess: any` an `http://` URL, an address on the local network, a `file://` path, or an inline `data:` image is stored as written. That is a deliberate operator choice for a Host only that operator uses; the closure rules and `remoteImageHosts` still apply.
- **A remote image depends on a third party staying up** — nothing is copied locally, so an unreachable host leaves the interface over the browser's own background until the user picks something else or the plugin is told the name is gone.
- **Deferred** — no server-side resizing or thumbnails, no cropping or tiling, and no separate strength for uploaded images, which the single opacity control already expresses.

**Runtime invariant:** No runtime invariant companion is published because every catalogue read re-reads the directory and the stored-id rule gates every name before it becomes a selection, so a persisted selection can only ever name a file the Host can serve; a name that no longer resolves is reported to the row and leaves the harness's own background in place.
