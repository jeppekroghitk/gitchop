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

Repositories owned by accounts you have linked are ranked above the rest of GitHub.

The panel itself — the links and the search — has a switch under Panels in Settings. Off, the menu
is only the columns you have on: the news alone, if that is all you want. With nothing else on the
panel stays, and the toolbar icon opens Settings either way.

## Private repositories

GitHub's search does not return private repositories. To find them, add a GitHub token in Settings
and press **Build index** — gitchop then keeps its own list of the repositories your token can reach,
and matches it locally.

Settings recommends a fine-grained token and warns against a classic one: the `repo` scope a classic
token needs grants write to every repository the account can reach, in every organisation, and
gitchop only ever reads. The fine-grained recipe is three steps. Name the owner — the exact name of
the organisation, or blank for your own account — and the link opens GitHub's form for that owner
with **Pull requests**, **Issues** and **Contents: read-only** already ticked, so only the
repositories and an expiration are left to choose. Name the owner in Settings rather than on the
form: GitHub clears the ticks the moment the owner is changed there. Then paste the token. A
fine-grained token covers one owner, so a second organisation is the same three steps again. Each
saved token is listed under the owner whose private repositories it reaches, so two organisations'
tokens read as two organisations, not two copies of you. One that reaches no private repository yet
says so. That is what a token awaiting an organisation's approval looks like: every token can list
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
to a GitHub list page. It paints from its last snapshot the instant the menu opens and refreshes behind
it; the toolbar icon carries the number waiting on you, so you know before you press the key.
Settings has a switch for the column under Panels, and for the badge and whether drafts count under Pull requests.

It needs a token that can read pull requests: a classic token with `repo`, or a fine-grained one with
**Pull requests: read-only**. A fine-grained token that was only granted Metadata is enough for the
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
page. The header says what it covers.

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
years with it — a fine-grained token sees fewer repositories than a classic one and may count fewer.
A switch under Panels in Settings turns it off.

## Backup

Links live in the browser profile, and go with the extension if you remove it. Connect a secret gist
under **Backup** in Settings and every change is written there as a new revision. The gist is written
with whichever saved token can reach it: a fine-grained token for your own account, which the token
link asks Gists for when the owner is left blank, or a classic token with `gist`.

[PRIVACY.md](PRIVACY.md) covers what is stored and what is sent to GitHub.

## Development

No build step for the code — the files in `src/` are what runs. Packaging only chooses which
`manifest.json` each browser gets, since the two disagree about the background script.

```sh
node dev/context.test.mjs && node dev/repos.test.mjs && node dev/effects.test.mjs && node dev/pulls.test.mjs && node dev/news.test.mjs && node dev/contributions.test.mjs && node dev/odometer.test.mjs && node dev/links.test.mjs
node dev/build.mjs all                                 # dist/gitchop-<version>-<browser>.<ext>
node dev/build.mjs chrome --no-zip                     # unpacked, for chrome://extensions
open dev/harness.html                                  # the menu, without installing
node dev/serve.mjs --open                              # the same over http, where Settings opens the real settings page
```

With [Task](https://taskfile.dev) installed, the same three are `task test`, `task build` and
`task harness`; `task` alone lists them.

The build refuses to package a manifest whose files do not resolve, imports included — with no
bundler in the way, that is the safety net.

[Releasing](dev/RELEASING.md) · [Changelog](CHANGELOG.md) · MIT
