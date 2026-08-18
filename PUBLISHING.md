# Publishing gitchop to addons.mozilla.org

## Before uploading

```sh
node dev/context.test.mjs && node dev/repos.test.mjs   # logic still holds
./dev/package.sh                                       # clean .xpi from a staging copy
npx --yes addons-linter@latest gitchop.xpi             # what AMO runs on upload
```

`addons-linter` must be current — older versions reject `data_collection_permissions` with
"the property is reserved", which is the linter being out of date, not the manifest being wrong.

Two warnings are expected and harmless:

- `background.service_worker` is unknown to Firefox. It is there so the same folder loads in Chrome;
  Firefox reads `background.scripts` and ignores it.
- `strict_min_version` is 115 while `data_collection_permissions` needs 140. Older Firefox ignores
  the key. Raise the minimum to `140.0` if you would rather have no warning than support ESR.

Errors, if any, must be fixed. There should be none: no minified or generated code, no remote
scripts, no `eval`, no `innerHTML`. That also means **no source-code upload is required** — the
package is the source.

## What AMO asks for

| Field | Value |
| --- | --- |
| Name | gitchop |
| Add-on ID | `gitchop@itk-dev` (already in the manifest; never change it after the first upload) |
| Summary | ≤250 characters — see below |
| Description | Longer text; the top of `README.md` adapts well |
| Categories | Two at most. *Developer Tools* fits; *Productivity* as the second |
| Icon | `icons/icon128.png` |
| Screenshots | At least one. The menu open on a repository page is the shot that sells it |
| License | MIT — `LICENSE` in this folder |
| Privacy policy | Required, because data collection is declared. Paste `PRIVACY.md` |
| Support site | The repository, once it is somewhere public |
| Version notes | What changed in this version |

A summary that fits:

> Press . anywhere on GitHub to chop the page open and reveal your own links. Search any repository
> from the same box, with your organisations first. Links back up to a secret GitHub gist, so they
> survive a reinstall.

## Notes for the reviewer

Paste this into the "Notes for reviewers" box. It answers the two things a reviewer will stop on.

> gitchop overrides GitHub's own "." shortcut, which normally opens github.dev. This is deliberate
> and is the extension's only trigger; it is stated in the listing description. The key is claimed on
> window in the capture phase, and while the menu is open keyboard events are stopped at the
> overlay's shadow host so GitHub's single-key shortcuts (s, e, t, y) cannot fire while the user is
> typing in our filter field.
>
> The user may optionally supply a GitHub personal access token. It is stored in storage.local, never
> storage.sync, and is used for exactly three things, all from the background script: identifying the
> account, listing the user's own repositories, and reading and writing one gist on their own account.
> Consent is requested at runtime through permissions.request for authenticationInfo and bookmarksInfo
> before either feature is switched on.
>
> Two features use it. Backup writes the user's link list to a secret gist, so it survives a reinstall.
> Private repository search calls /user/repos once, on an explicit button press, and keeps the
> resulting names and URLs in storage.local so the menu can match them locally — GitHub's search API
> does not reliably return private repositories. That list is never transmitted anywhere. The extension
> never reads repository contents, code, issues or pull requests.
>
> The settings page offers a classic token with repo and gist scopes as the simple path, and a
> fine-grained token with Metadata read-only as the tighter alternative, stating plainly that classic
> tokens have no read-only scope for private repositories. Any token carrying a write scope is
> labelled as such in the UI. Any number of tokens may be added, because a fine-grained token covers
> only one resource owner.
>
> Tokens are sealed with AES-GCM under a random key before being written to storage.local, so none is
> stored as recognisable text. This is documented in PRIVACY.md as obfuscation rather than protection:
> the key is necessarily reachable by the extension, and the intent is to defeat accidental exposure,
> not an attacker with disk access.
>
> Data coming back from the gist is treated as untrusted: it is sanitised, non-http(s) URLs are
> dropped rather than stored, and the list is capped. No row in the menu becomes a clickable link
> without passing a scheme check.
>
> No remote code, no eval, no innerHTML, no bundler, no dependencies. src/ is what runs.

## Data collection

Declaring this is mandatory for new extensions since 3 November 2025. gitchop declares:

- **Required — `searchTerms`.** Repository search sends what you type to GitHub's search API.
- **Optional — `authenticationInfo`, `bookmarksInfo`.** Only for gist sync: the token, and the link
  list itself. Requested at runtime when connecting sync, so it is not demanded at install.

Nothing reaches the author. Keep this and `PRIVACY.md` in step with each other; a mismatch between
the declaration and the policy is a review failure.

## Listed or unlisted

**Listed** puts it in the public marketplace, gets it reviewed, and auto-updates for anyone who
installs it. **Unlisted** just gets the `.xpi` signed so it installs in any Firefox, including
release, without publishing it — the right choice if this is only for you and colleagues, and it
skips both the review queue and the listing assets above.

Either way, once signed you no longer need `xpinstall.signatures.required=false`.

## After the first upload

The add-on ID is fixed forever. Version numbers must increase and cannot be reused, even for a
rejected upload — bump `manifest.json` and re-run `./dev/package.sh` for each attempt.
