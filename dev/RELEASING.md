# Releasing

## Cutting a release

1. Bump `version` in `manifest.json`.
2. Add the section to `CHANGELOG.md` under a `## <version>` heading — the release notes are read
   from it verbatim.
3. Commit, then tag:

   ```sh
   git tag v2.1.0 && git push origin main v2.1.0
   ```

The `release` workflow runs the tests, refuses the tag if it disagrees with `manifest.json`, builds
both packages and attaches them to a GitHub release:

| File | Goes to |
| --- | --- |
| `gitchop-<version>-firefox.xpi` | addons.mozilla.org |
| `gitchop-<version>-chrome.zip` | Chrome Web Store, and Edge or Brave unchanged |

Store submission stays manual. Both stores ask questions a workflow cannot answer honestly, and
neither rewards an extension that appears unattended.

To build the same files locally:

```sh
npm ci                               # esbuild, once, at the version package-lock.json pins
node dev/build.mjs all               # dist/gitchop-<version>-<browser>.<ext>
node dev/build.mjs chrome --no-zip   # unpacked, for chrome://extensions
```

## What differs per browser

One `manifest.json` in the repo root is the source; `dev/build.mjs` derives the rest. Only the
background script and the browser-specific block differ:

| | Firefox | Chrome |
| --- | --- | --- |
| Background | `scripts` (event page) | `service_worker` |
| Vendor block | `gecko`: id, min version, data collection | dropped |
| Also | — | `minimum_chrome_version` |

The reason there are two manifests rather than one is Chrome: before Chrome 121 it refuses to load a
Manifest V3 extension that mentions `background.scripts` at all, and Firefox has no service worker to
point at. Keeping both keys in one file works on current Chrome but leaves unrecognised-key warnings
in both stores' review tools.

Nothing else in `src/` is conditional. `globalThis.browser ?? globalThis.chrome` covers the namespace
difference, and every API in use returns promises in both.

## Firefox — addons.mozilla.org

The listing is at <https://addons.mozilla.org/en-US/firefox/addon/gitchop/>.

Upload the `.xpi` under **Add-on Manager → Upload New Version**. The content script
(`content.js`) and the settings page's preview stage (`src/options/stage.js`) are bundled by esbuild,
and AMO counts bundled code as generated, so answer **yes** when it asks whether the source must be
submitted, and attach it:

```sh
git archive --format=zip -o gitchop-<version>-source.zip v<version>
```

The archive carries `package.json` and `package-lock.json`, so the reviewer needs nothing else. The
bundles are not minified and carry no source maps, so they read as the sources joined up; the only
change esbuild makes is to number a name two modules both declare (`node2`). To reproduce them byte
for byte, with Node 22 or later:

```sh
npm ci && node dev/build.mjs firefox
```

That builds `dist/firefox/` and `dist/gitchop-<version>-firefox.xpi` from exactly the tree in the
archive, with the esbuild version `package-lock.json` pins. The background script, the rest of
the settings page and `src/lib/` are not bundled and are in the package as they are in `src/`.

The `data_collection_permissions` block in the Gecko settings is what AMO's disclosure form reads;
if what gitchop sends to GitHub ever changes, that block changes with it.

The name on the listing is `name` from the uploaded manifest, so it moves when that does. The slug
in the URL does not follow it, and identity is the `gecko.id` — which is why renaming is an update
and changing that ID would instead orphan every install.

## Chrome — Chrome Web Store

One-time setup: a Chrome Web Store developer account, a one-off 5 USD registration fee, and a
verified contact email at <https://chrome.google.com/webstore/devconsole>.

Upload `gitchop-<version>-chrome.zip` as a new item, then fill in:

- **Single purpose.** One sentence: a keyboard menu of links and repository search on github.com.
- **Permission justifications**, one per permission, each naming the feature that needs it:
  - `storage` — keeps the user's links and settings.
  - `alarms` — refreshes the pull requests every few minutes for the badge, and makes up the news
    edition once a day.
  - `github.com` host access — the content script that the `.` key runs on.
  - `api.github.com` host access — repository search, the pull requests, the news, the year's
    contributions and the gist backup, all called from the background script.
- **Remote code**: no. Everything executed ships in the package.
- **Data usage**: declare what `PRIVACY.md` already describes, and link it as the privacy policy.

As on AMO, the item name is the manifest's `name`; there is no separate title field to keep in step.

Review is usually a few days, and slower for a first submission from a new account.

Edge and Brave install the same zip unchanged. Edge has its own store (Partner Center) if that is
ever worth the trouble; Brave uses the Chrome Web Store directly.

## Checking a package before it goes anywhere

`dev/build.mjs` refuses to package a manifest whose files do not resolve — a mistyped
`content_scripts` entry, a `<script src>` in the options page, or a broken relative `import` — and
a script that would not parse the way the browser loads it: the content script as a classic script,
everything else as a module. esbuild refuses a broken import inside a bundle; the background is not
bundled, so for it the build's own check is the only thing standing between a typo and a store
upload. Treat a build failure as the release stopping.
