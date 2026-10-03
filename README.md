# gitchop

Press <kbd>.</kbd> on GitHub for your own links, instant repository search, and the pull requests
waiting on you.

**[Install for Firefox](https://addons.mozilla.org/en-US/firefox/addon/gitchop/)**

Chrome, Edge and Brave: take `gitchop-<version>-chrome.zip` from the
[latest release](https://github.com/jeppekroghitk/gitchop/releases/latest), unzip it, and load it at
`chrome://extensions` with developer mode on. Leave the unzipped folder where it is — Chrome derives
the extension's identity from that path, so moving or renaming it starts over with an empty link list.

If the menu does not open in Firefox, allow access to `github.com` in `about:addons` → gitchop →
Permissions, then reload the tab — Firefox does not grant that at install. Chrome grants it when you
install, unless site access has been narrowed to *on click*.

## Keys

| Key | Does |
| --- | --- |
| <kbd>.</kbd> | Open the menu |
| type | Filter your links; 3 characters or more also searches repositories |
| <kbd>↑</kbd> <kbd>↓</kbd> | Move |
| <kbd>→</kbd> | Go inside a repository — its pull requests, its issues, or subscribing to its news; on any other row, across to the pull requests |
| <kbd>←</kbd> | Back out of a repository, or back to the menu from the pull requests |
| <kbd>↵</kbd> | Open |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>↵</kbd> | Open in a new tab |
| <kbd>Tab</kbd> | Across to the pull requests and back, from any row |
| <kbd>Esc</kbd> | Close |

`Add this page` and `Settings` are rows in the list; type `add` or `settings` to reach them. On a
repository's page, so is `Subscribe to news`.

This takes over GitHub's own <kbd>.</kbd> shortcut, which normally opens github.dev.

## The chop

The opening animation is tuned in Settings. An **Effect** switch turns it off altogether — the dot
then opens the menu instantly. **Colour** is eighteen named swatches — steel is the classic blade,
any other paints the blade, sparks and light. **Epicness** is one dial from a clean quiet cut to a
full action scene: the glow deepens first, then sparks fly, then light bursts from the cut.
**Speed** slows the slice into slow motion or hurries it — the aftermath keeps its
slow drama at any speed. **Menu delay** is the beat between the blade leaving the screen and the
menu rising into the cut, shown as the wait it actually produces: nothing at all at one end, long
enough for the dark to settle first at the other. **Preview chop**
plays the result over the settings page before you leave it, saved or not. The defaults are the
classic cut, and `prefers-reduced-motion` keeps everything to a plain fade no matter the settings.

## Links

Add links in Settings. A URL can contain placeholders, filled in from the page you are on, so that
one link works on every repository:

| Placeholder | Value |
| --- | --- |
| `{owner}` | Repository owner |
| `{repo}` | Repository name |
| `{repoFull}` | `owner/repo` |
| `{branch}` | Current branch or ref |
| `{path}` | Path inside the repository |
| `{number}` | Issue or pull request number |
| `{url}` | The current URL |

`https://github.com/{repoFull}/actions` goes to the Actions tab of whichever repository you are
looking at. A link whose placeholders cannot be filled is greyed out.

Repositories owned by accounts you have linked are ranked above the rest of GitHub. Type an exact
`owner/repository`, or paste its address, and that repository is the first row whatever else
matches — `leantime/leantime` lands on Leantime/leantime even when your own index holds ten other
leantime things. Up to ten repositories are listed, and the list scrolls.

The panel itself — the links and the search — has a switch under Panels in Settings. Off, the menu
is only the columns you have on: the news alone, if that is all you want. With nothing else on the
panel stays. Without it, the column nearest where the panel would be — the pull requests, or the
news alone — ends in a strip with a *settings* word that opens Settings, since the row that did so
sits in the links; the toolbar icon opens Settings either way.

## Welcome

Nothing opens on install. The first time you press <kbd>.</kbd> on GitHub, the chop plays and a
short welcome takes the menu's place: what signing in unlocks, and **Sign in with GitHub**, carried
out right there in the overlay — the code, GitHub's device page in a new tab, then the
organisations to install the app on — ending in the menu. **Continue without signing in** at the
bottom puts it aside, and it never shows again; Escape or the ✕ only close it, and the next press
greets you again. Until you sign in, save a token or put
the welcome aside, the toolbar button opens the same welcome on a page of its own rather than
Settings. While nothing is signed in, the menu ends in one quiet row, *Sign in to search your
private repositories*, that starts the sign-in in the overlay; its ✕ hides it for good. On Firefox,
until you have consented to gitchop holding a token, **Sign in with GitHub** opens a gitchop tab
with that one question, as a step of its own before the sign-in; answer it and the tab closes,
back to GitHub, where the sign-in carries on in the overlay. Updating from 2.9 or older shows no welcome: the key stays the
menu you know, with the sign-in row at the end.

Chrome does not add gitchop to GitHub tabs that were already open when you installed it: reload
them, or open a new one, before pressing <kbd>.</kbd>.

## Signing in

**Sign in with GitHub**, in the welcome or under Sign-in in Settings, is how gitchop reaches your private repositories,
pull requests and gist. It shows a short code; open github.com/login/device, type the code, and
approve *gitchop for GitHub*. The page carries on by itself and says *Signed in as @you*. The sign-in
renews itself in the background every eight hours or so, and after about six months unused, or if
GitHub refuses a renewal, the card says *signed out* with **Sign in again**. **Sign out** forgets it
here; revoke it on GitHub at github.com/settings/applications.

Signing in uses a GitHub App, so what it can read is read-only — Metadata, Contents, Issues and Pull
requests — plus Gists for the backup, and the repository part works only where the app is
installed. After you sign in, the card lists where it is installed and, for your own account and
the organisations in your links that do not have it, an **Install on @org** link. Organisations a
saved fine-grained token already reaches are listed as covered by that token instead. You pick the
repositories on GitHub; an organisation owner installs at once, while a member's install becomes a
request to the owners. Until an organisation has the app or a token, gitchop sees only its public
repositories, with no error from GitHub to say so — add a personal access token for that
organisation instead, from the same card. Signing in counts only your public contributions; a
classic token with `read:user` is still the way to count private ones.

## Private repositories

GitHub's search does not return private repositories. To find them, sign in or add a GitHub token in
Settings and press **Build index** — gitchop then keeps its own list of the repositories your tokens
can reach, and matches it locally. A search that names an owner goes out with the token that sees the
most of that owner, and a bare word with the widest reach you have.

Personal access tokens are under **Advanced** on the Sign-in page, and work beside a sign-in. Settings
recommends a fine-grained token and warns against a classic one: the `repo` scope a classic
token needs grants write to every repository the account can reach, in every organisation, and
gitchop only ever reads. The fine-grained recipe is three steps. Name the owner — the exact name of
the organisation, or blank for your own account — and the link opens GitHub's form for that owner
with **Pull requests**, **Issues** and **Contents: read-only** already ticked, so only the
repositories and an expiration are left to choose. Name the owner in Settings rather than on the
form: GitHub clears the ticks the moment the owner is changed there. Then paste the token. A
fine-grained token covers one owner, so a second organisation is the same three steps again. Each
saved token is listed under the owner whose private repositories it reaches, so two organisations'
tokens read as two organisations, not two copies of you. One that reaches no private repository yet
says so, and is listed under the owner you named in the recipe until it does. Every row says when
the token expires. That is what a token awaiting an organisation's approval looks like: every token can list
public repositories, whoever it was made for, so until the approval it indexes the public half of
every organisation you belong to and nothing private, and the index card's private count reads zero.

## Pull requests

With a token saved, a second column rises beside the menu: the pull requests that concern you, in
three lanes. **Feedback on your PRs** is your work that has a verdict — approved, or changes
requested. **Waiting on you** is what others need your review for. **Waiting on others** is your work
that nobody has answered yet. Every open pull request you are party to lands in exactly one of them.

The search keeps focus; the column is there to be looked at. <kbd>→</kbd> or <kbd>Tab</kbd> crosses
into it, <kbd>↑</kbd> <kbd>↓</kbd> walk the lanes, <kbd>↵</kbd> opens, <kbd>←</kbd> comes back, and
typing anything drops you straight back into the search with the character you typed. Every lane
shows everything it holds — the column scrolls when there is more than fits — so nothing sends you off
to a GitHub list page. It paints from its last snapshot the instant the menu opens and asks GitHub
again every time, so what you see is the list as it stands: a pull request you have just reviewed,
or one of yours merged while you were away, is ticked off and swept from its lane before your eyes,
the lane closing up under it, and one of yours that has gained its verdict crosses to *Feedback on
your PRs*. A lane that empties says so. The toolbar icon carries the number waiting on you, so you
know before you press the key. Settings has a switch for the column under Panels, and for the badge
and whether drafts count under Pull requests.

It needs a sign-in or a token that can read pull requests: a classic token with `repo`, or a
fine-grained one with **Pull requests: read-only**. A fine-grained token that was only granted Metadata is enough for the
index but shows the lanes empty rather than refusing — GitHub returns less, not an error. Viewports
narrower than about 980 px have no room for it, and the menu is what it always was.

## News

Subscribe to a repository and a column rises on the other side of the menu with what happened in
it, told in a few sentences: *Released v3.1.0. 23 commits to develop by tuj, jekuno and 2 more.
2 pull requests merged, 1 opened and 1 closed without merging. 2 issues opened and 1 closed.* A
quiet day says *nothing new*. Every fact in the prose is a chip: hover it, and what it is made of
unfolds beneath the sentence — the pull requests behind the count, every commit of the day with
its message and author, the releases by name — each a link. The list scrolls inside the popover
past about twenty lines, and it stays while the mouse is over the chip or the popover itself, so
a busy day can be read without leaving the page. Clicking the chip itself opens GitHub's own
list of exactly that, cut to the window.

It is a morning paper rather than a feed. The edition is made up once a day, at 08:00 unless
Settings says otherwise, and covers everything since the previous one: yesterday at the same hour
on an ordinary day, and back to Friday's on a Monday if the browser was shut over the weekend, up
to a week. It is then left alone until the next, so glancing at it twice in a day shows the same
page. The header says what it covers. **Covers** in Settings stretches every edition to as much as
a week — the last seven days, made up fresh each morning — for a repository worth reading at a
week's remove, or a menu opened on Fridays only. That costs GitHub no more requests: the same five
per repository whatever the window, only bigger pages, and a page more of commits in a repository
busy enough to need it.

To subscribe, press → on any repository row — a saved link that points at a repository, or a
search result — and choose **Subscribe to news** under *Pull requests* and *Issues*; the same row
unsubscribes. On a repository's own page the command sits in the list under *Do*, since the links
that point inside a repository do not have a row for the repository itself. Settings has the list,
a way to add one by name, the edition hour, and a **Refresh now** that asks GitHub again without
moving the window; the switch for the column is under Panels.

The column is read with the mouse and never takes the keyboard: prose is not a list of rows to
be a cursor in, so the arrows and Tab stay with the links and the pull requests exactly as
before. Public repositories need no token; a private one is fetched with whichever saved token
can see it, and says so in Settings when none can. Three columns need about 1280 px; below that
the news steps out first and the menu is what it was.

## Contributions

With a token saved, the head of the menu carries the number your profile prints for the year —
*1234 contributions in 2026* — beside the title, spun in like a slot machine's: every reel turns
from the moment the panel is up and they stop one at a time, left to right, the first at once and
each next one a beat later. It paints from its last snapshot; when the menu opens on one older than five minutes it
asks GitHub again behind it, and a count that has grown since rolls its last digits on, so the day's
work is seen to arrive. Hovering the number shows the totals for the three years before it, so this
year has something to stand beside. It is not a link; it is there to be looked at.

It is one GraphQL request per saved token, asking for this year from January the 1st to now and for
each of the three whole years before, and the highest count for this year is the one shown, its past
years with it — a fine-grained token or a sign-in sees fewer repositories than a classic one and
may count fewer. Private contributions are counted only for a classic token with `read:user`, which
the classic token link asks for.
A switch under Panels in Settings turns it off.

## The gauge

In the bottom right corner of the dark, under a *Rate limits* head, three bars say how much of
GitHub's budgets is used: *graphql* for the pull requests and the contributions, *rest* for the
news, the index and the gist, *search* for typing a repository. Each bar is lit the colour of the
blade and fills from empty at nothing used to full at the limit, with the share used as a figure
beside it, and above it the count used — *88/5000* — and how long until the allowance turns; past
nine tenths a bar turns red. The bars fill as the panel rises. GitHub says all of this in the
headers of every answer, so the gauge costs no request of its own: it is read off the answers as
they come, and follows them while the menu is up — the pull requests asked for on open take their
points before your eyes, and so does every search typed. GitHub meters by user rather than by
token, so two tokens of one account are one set of bars, and a second account's a second set under
its name; what is asked without a token, which GitHub allows far less of, is listed as *no token*.
A budget whose allowance has turned since it was last read is back at nothing, since nothing has
been charged to it since.

## Backup

Links and settings live in the browser profile, and go with the extension if you remove it. Connect a
secret gist under **Backup** in Settings and every change is written there as a new revision: the
links, the repositories you subscribe to for news and the edition hour, the switches under Panels and
Pull requests, and the chop. Tokens never go in it. A pull replaces what is here with what the gist
holds; a gist made by an earlier version holds only links, and is written back whole once read. The
gist is written with whichever can reach it: a sign-in, which holds Gists without installing the app
anywhere, a fine-grained token for your own account, which the token link asks Gists for when the
owner is left blank, or a classic token with `gist`.

[PRIVACY.md](PRIVACY.md) covers what is stored and what is sent to GitHub.

## Development

The content script is ES modules that [esbuild](https://esbuild.github.io) bundles into each
package — content scripts cannot import anything on their own — and so is the stage the settings
page previews the chop with, so the repository root is not an extension you can load as it
stands. Install the build's tools once, then build and load `dist/<browser>`:

```sh
npm ci                                                 # esbuild, TypeScript and ESLint, pinned by package-lock.json
node dev/build.mjs firefox --no-zip                    # dist/firefox: about:debugging → This Firefox → Load Temporary Add-on → its manifest.json
node dev/build.mjs chrome --no-zip                     # dist/chrome: chrome://extensions → Load unpacked
node dev/build.mjs firefox --watch                     # the same, rebuilt on every change; reload the extension to pick it up
node dev/build.mjs all                                 # dist/gitchop-<version>-<browser>.<ext>
```

Nothing is minified and there are no source maps: the bundles are the sources joined up, though
where two modules declare the same name esbuild numbers one of them (`node2`). Packaging also
chooses which `manifest.json` each browser gets, since the two disagree about the background
script, which reaches the browser unbundled.

```sh
npm test                                               # node --test over every dev/*.test.mjs; one file alone is node --test dev/<name>.test.mjs
npm run lint                                           # ESLint: the recommended rules, with the globals of wherever each directory runs
npm run typecheck                                      # tsc -p .: the JavaScript checked from its JSDoc, nothing emitted; types/ declares the extension APIs
node dev/serve.mjs --open                              # the harness: the menu without installing, and Settings opens the real settings page
```

Over the server, the harness bundles the content script and the settings page's stage from `src/`
on every request, so a reload runs whatever was just saved. Opened from `file://` — handy for
headless screenshots — it runs `dev/content.js` instead, a git-ignored copy that every build and
`node dev/bundle.mjs` write; the settings page needs the server either way.

With [Task](https://taskfile.dev) installed, the same are `task test`, `task lint`, `task typecheck`,
`task build`, `task watch` and `task harness`; `task` alone lists them.

The build refuses to package a manifest whose files do not resolve, imports included, or a script
that would not parse the way the browser loads it — the background is not bundled, so that is its
safety net.

[Releasing](dev/RELEASING.md) · [Changelog](CHANGELOG.md) · MIT
