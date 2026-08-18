# gitchop

A browser extension that chops GitHub in half. Manifest V3, no build step, Firefox and Chrome.

Press <kbd>.</kbd> anywhere on `github.com` — outside of an input or textarea — and a blade travels the
full width of the screen on a diagonal, the dark closing in behind it, leaving your own menu of links.

## Install

Nothing needs building. The files in `src/` are what the browser runs — plain JavaScript, CSS and
HTML, no bundler, no transpiler, no `node_modules`. Packaging is only ever `zip`.

### Firefox, until restart

1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → pick `manifest.json` in this folder.
3. Open any page on `github.com` and press <kbd>.</kbd>.

Fastest way in, and reloading after an edit is one button. It is dropped when the browser closes.

### Firefox, permanently

Requires a build with `MOZ_REQUIRE_SIGNING=false` — Zen, LibreWolf, Waterfox, Developer Edition,
Nightly. Release Firefox ignores the pref below and will refuse an unsigned add-on; for that, get the
`.xpi` signed as an unlisted add-on at [addons.mozilla.org](https://addons.mozilla.org/developers/).

1. Build the archive:

   ```sh
   ./dev/package.sh
   ```

   It stages a clean copy so `manifest.json` lands at the archive root, which Firefox requires, and
   nothing local tags along.

2. In `about:config`, set `xpinstall.signatures.required` to `false`.
3. In `about:addons`, the gear icon → **Install Add-on From File…** → pick `gitchop.xpi`.

To check which kind of build you are on, `about:support` names the channel; or ask the binary
directly:

```sh
unzip -p /Applications/Zen.app/Contents/Resources/omni.ja modules/AppConstants.sys.mjs \
  | grep -oE 'MOZ_REQUIRE_SIGNING: *(true|false)'
```

### If the chop does nothing

**Grant access to `github.com`.** Firefox treats `host_permissions` in Manifest V3 as *optional* — they
are listed but not granted, and until they are, the content script is never injected and the <kbd>.</kbd>
key does nothing, silently. Two ways to see and fix it:

- The toolbar icon carries a red `!` whenever access is missing. Clicking it opens the settings page,
  which leads with an **Access to GitHub** card and a button that asks for the permission directly.
- Or do it by hand in `about:addons` → gitchop → **Permissions**.

Either way, **reload any GitHub tab that was already open** — content scripts are injected as a page
loads, so tabs older than the grant are not covered.

Worth knowing that reinstalling can clear the grant, which makes a working extension look broken after
an update. That is what the badge is for.

To confirm from outside the browser, the grant is recorded in the profile:

```sh
python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print([a['userPermissions'] for a in d['addons'] if 'gitchop' in a['id']])" \
  ~/Library/Application\ Support/zen/Profiles/*/extensions.json
```

An empty `origins` list there means it has not been granted.

### Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. **Load unpacked** → pick this folder.
4. Open any page on `github.com` and press <kbd>.</kbd>.

Each browser warns about one key in `manifest.json` that belongs to the other — Chrome about
`background.scripts`, Firefox about `background.service_worker`. Both are warnings, not errors; the
extension loads either way.

## Using the menu

| Key | Does |
| --- | --- |
| <kbd>.</kbd> | Chop the page open |
| type | Filter links; 3+ characters also searches repositories |
| <kbd>↑</kbd> <kbd>↓</kbd> | Move between rows |
| <kbd>→</kbd> | Go inside the highlighted repository |
| <kbd>←</kbd> | Back out of it |
| <kbd>↵</kbd> | Open the highlighted link |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd>/<kbd>⇧</kbd> + <kbd>↵</kbd> | Open it in a new tab |
| <kbd>Esc</kbd> | Un-chop |

`Add this page` and `Settings` are rows in the list rather than buttons, so they are reachable by
typing — `add`, `save` or `bookmark` finds the first; `settings`, `manage` or `sync` the second. With
an empty filter both sit under your links. The extension's toolbar icon opens the same settings page,
where links can be renamed, reordered and deleted.

The highlighted row shows a `→` on the right, or a `›` if there is a level underneath it. That is the
whole right-hand column — the full URL used to live there and it was noise, truncated to `noti…` and
telling nobody anything. It survives as the hover title, and as the greyed note on a link whose
placeholders cannot be filled.

## Finding a repository

Type three characters or more and the menu searches GitHub for repositories underneath your own
links, so any repo is reachable without leaving the keyboard:

- `leantime` searches, best match first.
- `leantime/leantime` is looked up directly, so it resolves to the canonical
  `Leantime/leantime` — case does not have to be right.
- A pasted `https://github.com/owner/repo` is treated the same as `owner/repo`.
- `◆` marks a private repository, `◇` a public one. Hovering shows the description.

If a slashed query turns out not to exist, it falls back to searching on the repository half rather
than dead-ending.

### Your own organisations come first

Any account you have linked is treated as an account you care about. Link `github.com/itk-dev`, or
anything inside it, and searching `economics` puts **itk-dev/economics** above every other project of
that name, marked with a dim left edge:

```
Repositories
▏◆ itk-dev/economics
 ◇ someone-else/economics
```

Owners are read straight off the links, in the order they appear, so reordering them in the settings
page reorders the qualifiers. Placeholder URLs and GitHub's own pages (`/notifications`, `/pulls`)
are not mistaken for accounts, and the list is capped at five. They were once grouped under their own
heading, which was dropped: one heading versus two changed the panel height, and holding that still
matters more.

This costs two requests per search — one restricted to those owners with `in:name`, one across all of
GitHub — run in parallel, with the restricted hits kept first and duplicates dropped. If one fails
the other still shows. Searching works without a token at GitHub's anonymous rate limit (10 requests
a minute, so five searches); adding one raises it to 30.

### Private repositories

GitHub's search will not return private repositories, and no amount of token scope makes it reliable
for them. So gitchop keeps its own list instead: **Private repository search** in the settings page
fetches every repository your token can reach — `/user/repos`, paginated, up to 600 — and stores names,
URLs and descriptions in `storage.local`.

That local list is matched first, on every keystroke, with no request at all. Matching ranks an exact
name above a prefix above a substring, shortest name winning ties, which beats relevance ranking when
you already know what the repository is called. GitHub's search still runs underneath for everything
you have no access to, and the two are merged with the local hits first and duplicates dropped.

It needs a token that can see repositories. **One classic token with `repo`** is the simple answer and
covers every organisation you belong to with no approval from anyone — at the cost of also granting
write, since classic tokens have no read-only scope for private repositories. A **fine-grained token
with Metadata: read-only** grants less but covers one owner each, so two organisations means two
tokens and possibly two approvals. gitchop accepts any number of tokens and indexes across all of
them, so either works.

The card reports what it got: how many repositories, how many private, and **which accounts they came
from**. That last line matters with fine-grained tokens, which fail quietly — an organisation missing
from it was never granted, or is waiting on an owner's approval, and GitHub returns a successful
response with less in it either way. Zero private repositories is called out. A token that fails does
not sink the others; the card names it. The list is a snapshot; press **Refresh** after joining a new
project.

Tokens are sealed with AES-GCM under a random key before being written to `storage.local`, so none
sits in the profile as `ghp_…` text. That is obfuscation and not protection — the key is necessarily
reachable by the extension too — but it takes tokens out of reach of greps, backup scanners and
screenshots, which is where credentials usually leak from.

Queries go to GitHub's search API as you type, debounced by 300 ms, from the background script.

### Why the panel holds still

**The panel is a fixed size.** The list is `min(48vh, 344px)` tall whatever is in it, and scrolls if
the content is taller. Nothing else works: an earlier attempt reserved a five-row block for the
repositories and left the links free, and typing `eco` still walked the panel through four heights —
940, 1150, 670, 740 px — because filtering the links away moves far more than the search results do.
A frame that never resizes is the only version you can rely on, and the arrow keys scroll the active
row into view, so a taller list costs nothing.

Within that frame, the list is rebuilt 110 ms after the last keystroke rather than on every one, so a
quickly typed word settles once instead of once per letter. Any key that acts on the list flushes that
first, so <kbd>↵</kbd> can never fire against a list one keystroke out of date. The network debounce is
separate and longer, at 300 ms.

The repository section appears from the first character — a hint, then shimmering skeletons, then up to
five results — so crossing the three-character search threshold changes what is in the section rather
than whether it exists.

### Going straight into a repository

Any row that resolves to a repository's front page shows a `›` instead of the usual `→`. Press
<kbd>→</kbd> on it and the list becomes the places inside that repository — pull requests and issues
— so a search can end on the pull requests page rather than the front page. <kbd>←</kbd> or
<kbd>Esc</kbd> comes back out, and typing anything leaves too, because typing means a new search.
Clicking the `›` does the same as pressing <kbd>→</kbd>.

Those two destinations are the `IN_REPO` array at the top of `src/content/menu.js`, one line each.
Branches, commits, releases and settings were tried there and cut for not being worth a keystroke.

This works on saved links as well as search results: a link pointing at `github.com/itk-dev/economics`
is a repository front page, so it drills in too. An owner on its own does not, nor does a deeper page.

<kbd>→</kbd> only takes over once the caret is at the end of what you have typed, so it still moves
the cursor through the query first. The footer says which keys are live for whatever is highlighted.

## Placeholders

A link URL may contain placeholders, which are filled in from the page you press <kbd>.</kbd> on:

| Placeholder | Value |
| --- | --- |
| `{owner}` | Repository owner |
| `{repo}` | Repository name |
| `{repoFull}` | `owner/repo` |
| `{branch}` | Current branch or ref |
| `{path}` | Path inside the repo, when browsing files |
| `{number}` | Issue, pull request or discussion number |
| `{url}` | The full current URL |

So `https://github.com/{repoFull}/actions` is one link that points at whichever repository you are
looking at. Links whose placeholders cannot be filled — a repo link while you are on
`/notifications` — are shown greyed out with a note about what is missing.

## Where links are kept

Two copies, on purpose.

`storage.sync` is the **working copy**. The menu reads it, so it opens instantly and works offline,
and it rides the browser profile across devices on its own. What it is not is durable: it belongs to
the extension install, so removing the add-on or resetting the profile takes it with them.

A secret **GitHub gist** is the durable copy, and the one to trust. Connect it in the options page and
every change is written to `gitchop.json` in that gist a second or so later. Because gists are
versioned, each save is a revision — an older list can always be recovered from the gist's history,
which is the part `storage.sync` can never offer.

To connect it:

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with
   **Account permissions → Gists: Read and write**, and **Metadata: Read-only** if you also want
   private repository search. A classic token with the `gist` scope works for backup alone.
2. Paste it into **Backup & sync** in the options page. Leave the gist field empty to have one
   created from the current links, or paste an existing gist id to adopt what is already there.

After that it looks after itself: a push about a second after any change, a pull when the browser
starts. **Pull now** and **Push now** force a direction when needed, and the pending state is shown so
it is never a mystery whether the gist is current.

How conflicts resolve: last write wins, with one guard — an automatic pull will not run over local
changes that have not reached the gist yet; it pushes them first. Forcing a pull does overwrite them,
and asks first.

On the token: it is held in `storage.local`, deliberately not `storage.sync`, so it is never shipped
to Mozilla's sync servers. Every request to GitHub is made from the background script, so no page
context ever sees it. It is only ever sent to `api.github.com`. **Disconnect** forgets it and leaves
the gist alone.

Firebase would also have worked, and was the other option considered. It loses on cost of ownership:
a Google project to keep alive, security rules to get right, and either a vendored SDK or hand-rolled
Firestore REST calls, since Manifest V3 forbids loading remote code. A gist needs one token and gives
version history for free.

## How the chop works

The blade and its bloom are boxes lying along the cut, rotated onto that axis, and wiped open from
their own local right to their own local left with an animated `clip-path: inset()`. Because they sit
on the cut's axis, one sweep draws the blade straight across the viewport in 240 ms, right to left. The glint travels
in lockstep on the same easing, so it stays at the tip with a tail behind it.

The dark behind it does not move — it is a plain full-viewport fade, starting at 195 ms so it lands
just as the blade finishes, over 120 ms. Wiping the dark in along the blade was tried and looked
worse: a moving overlay reads as machinery, where a fast fade reads as the lights going out.

Paint order is scrim, bloom, blade, menu. The blade is above the dark so it stays visible against it,
and below the panel so it never crosses the menu.

The page itself is never touched or copied. An earlier version did cut the page in two — drawing a
snapshot twice, each copy clipped to one side, sliding the halves apart — but that needs a picture of
the page, and no way of getting one is worth it: `tabs.captureVisibleTab` demands `<all_urls>` in
Firefox, and `-moz-element()` did not paint reliably. The current version needs no picture, so
gitchop asks for no permission beyond `storage`, the host it runs on, and `api.github.com` for the
gist.

Under `prefers-reduced-motion: reduce` there is no sweep; the dark simply fades in.

## Development

There is no build step; the files in `src/` are what runs.

- `node dev/context.test.mjs` checks the URL parsing and placeholder filling, and
  `node dev/repos.test.mjs` checks which owners get favoured in search.
- `./dev/package.sh` builds `gitchop.xpi` from a clean staging copy, so editor and tooling
  leftovers cannot reach a reviewer. Use it rather than zipping the folder by hand.
- `dev/harness.html` runs the whole overlay as a plain web page, with the extension APIs stubbed and
  a fake GitHub page behind it, so the animation can be looked at without installing anything. Open
  it straight from disk. `?slow=6` stretches every animation six times for inspecting single frames.
- `python3 dev/make_icons.py` regenerates `icons/` — no image library needed.

## Notes

- GitHub binds <kbd>.</kbd> to opening github.dev. gitchop claims the key first, so that shortcut is
  no longer reachable while the extension is enabled.
- `{branch}` is read from GitHub's branch picker, falling back to the URL. On pages with neither it
  resolves to empty and the link is greyed out.
- Only `http(s)` URLs can be stored; anything else is rejected in the options page and refused by
  the menu.
- The overlay lives in a closed shadow root, so GitHub's stylesheet cannot reach into it and its
  stylesheet cannot leak out.

## Layout

```
manifest.json
LICENSE                  MIT
PRIVACY.md               what leaves the machine, and where it goes
PUBLISHING.md            getting it onto addons.mozilla.org
icons/
dev/                     harness, tests, icon generator, packaging — not shipped
src/
  background.js          gist sync, repo search, options page, first-run defaults
  lib/links.js           link storage, defaults, validation
  lib/gist.js            the GitHub gist that holds the durable copy
  lib/repos.js           repository lookup, search, and the local index
  lib/vault.js           seals tokens so they are not stored as plain text
  content/
    context.js           what repo/branch/issue the current page is
    styles.js            the overlay's CSS, injected into a closed shadow root
    chop.js              cut geometry and the animation timeline
    menu.js              the panel: filtering, keyboard nav, inline add form
    main.js              the "." hotkey and the open/close sequence
  options/               links, token, private repository index, backup & sync
```
