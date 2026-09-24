# Changelog

Reconstructed from the development history; this project has no git history before 2.0.0 to derive
it from.

## Unreleased

- The token card in Settings is a recipe rather than an essay. The fine-grained token comes first,
  marked recommended, in three numbered steps: name the owner, open GitHub's form for it, paste what
  comes back. The owner step says outright that typing the exact name of the organisation is what
  pre-ticks the permissions, and the link and its hint rename themselves to that owner as you type.
  The classic token is warned against in a red box instead of being offered as the simplest, since
  its repo scope is write everywhere the account reaches; a saved classic token gets the same box in
  place of the old note, telling you to replace and revoke it. The account of how tokens are stored
  folds away under a heading. The recipe stays at the top once tokens are saved, and the saved
  tokens are listed beneath it, so what is pasted appears right below where it was pasted and the
  card does not reshuffle when the first token lands; a second organisation is the same three steps
  again.
- Backup has a card of its own in Settings, its own page under GitHub, with its own status corner.
  It used to share the token card, so the gist field and its buttons ran on from the token rows.
  Without a token the card says what backup would take; with one, the gist field and the switch;
  connected, the gist and the last pull and push, with the pull, push and stop. A failure shows on
  the card whose button caused it, and the background's own last error, which is always the gist's,
  shows on the backup card. The token card is tokens only.
- The fine-grained token link in Settings now opens GitHub's form with the grants ticked — Pull
  requests, Issues and Contents read-only, and Gists for the backup when the token is the account's
  own — so only the repositories are left to choose. The owner is named in a field beside the link
  and travels with it, because GitHub clears every tick the moment the owner is changed on the form
  itself. The same recipe stays at the top of the card once a token is in place, which is where the
  second organisation's token is made. Metadata read-only alone was enough for the index but left
  the pull request lanes empty and the news from a private repository failing, and the form gave no
  hint of which of the forty-odd permissions gitchop actually reads.
- A saved fine-grained token is listed under the owner it reaches, read off the private repositories
  it lists, rather than under the login of whoever made it — which is the same login on every one,
  so three organisations' tokens read as three identical rows. Public repositories are left out of
  that reading because they say nothing: every token can list them, whoever it was made for, and a
  token awaiting an organisation's approval lists the public half of every organisation the account
  belongs to and nothing else. Such a token's row says it reaches no private repositories yet, and
  the index card now says the same — its earlier claim that an unapproved organisation would be
  missing from the account list was wrong, since the organisation shows up with its public
  repositories and only the private count gives it away. Classic tokens keep the login: they are the
  account's and cover everything it can reach. Tokens saved before this learn their owner the next
  time the index is built.
- **Your contributions this year, in the head of the menu.** With a token saved, the number your
  profile prints for the year — *1234 contributions in 2026* — sits beside the title, spun in like a
  slot machine's: every reel sets off the moment the panel is up and they stop one at a time, left
  to right — the first as good as at once, each to its right 600 ms after the one before, each
  turning as many times on the way as keeps the whole row at one slow, readable pace. A count that
  arrives while they are still turning keeps every stop where it was and only changes the digit each
  reel stops on. It paints from its last snapshot; a menu opened on one older than five minutes asks
  GitHub again behind it, and a count that has grown since rolls its last digits on, so the day's
  work is seen to land rather than blinked in. A nine rolling over keeps going up. Hovering the
  number hangs the totals for the three years before it beneath, so this year has something to stand
  beside; it is not a link. Reduced motion shows the numbers plainly. It is one GraphQL request per
  saved token — the calendar total from January the 1st to now, and each of the three whole years
  before under its own alias, so a year GitHub refuses is a year left out rather than a failed
  answer — and the highest count for this year wins, its past years with it, since a fine-grained
  token sees fewer repositories than a classic one and may count fewer. Years before the account
  existed are left out rather than shown as nought. A switch under Panels in Settings turns it off.
  Removing the last token deletes the snapshot with the rest. (#7)
- **The settings page is paged.** Eight cards in one column had become a long scroll, so a rail on
  the left now names every page under three headings — General: Panels, one switch each for the
  links panel, the pull requests column, the news column and the contributions count, with room for
  more; The chop. The links panel — the links and the search — can be switched off too: the menu is
  then only the columns you have on, the news alone if that is all you want, and with nothing else
  on the panel stays. Menu: Links, with the placeholders under the links; Pull requests; News.
  GitHub: Tokens, Index, Backup — and one page stands on the right at a time, Links to begin with.
  The page remembers the card it was left on, in the address and for the next visit; up and down
  walk the rail. A narrow window puts the rail above the card as a row instead. Each page has its
  own headline, with the status corner beside it, and a line under it saying what the feature is;
  then the box, with the settings themselves and nothing else, not even a title bar; then, below it,
  what is worth knowing about them as they stand — so only controls sit inside a border. Every note
  is shorter, the token card's list of every call made with a token is a link to the privacy notes
  that carry it, and the notes that pointed at a card "above" or "below" now name its page. The
  pages that can do nothing without a token — Pull requests, Index, Backup — are dimmed on the rail
  until one is saved, and each shows one line saying so with the way to the Token page in place of
  controls that could only fail. Every card stays in the document, only hidden, so nothing about how
  they load or save has changed. (#3)

## 2.5.0

- **News from the repositories you follow.** Subscribe to a repository and a third column rises on
  the left of the menu with what happened in it, told in a few sentences — *Released v3.1.0.
  23 commits to develop by tuj, jekuno and 2 more. 2 pull requests merged, 1 opened and 1 closed
  without merging. 2 issues opened and 1 closed.* — most newsworthy first, and one quiet line when
  nothing did. Every fact in the prose is a chip: hover it, and what it is made of unfolds
  beneath the sentence — the pull requests behind the count, every
  commit of the day with its message and who made it, the releases by name — each line a link.
  Nothing is cut: the list scrolls inside the popover past about twenty lines, and it stays while
  the mouse is over the chip or the popover itself — the gap between them belongs to the popover,
  since the next line's chips begin in it — so a busy day can be read and scrolled without leaving
  the page. Only a fetch that stopped before the day did — a
  fourth hundred commits, a fifty-first pull request — ends the list with a line pointing at
  GitHub. Clicking the chip itself opens GitHub's own list of exactly that, cut to the window. It
  is a morning paper, not a feed: the edition is made up
  once a day at the hour set in Settings (08:00 to begin with), covers everything since the previous
  edition — yesterday at the same hour, or back to Friday's on a Monday when the browser was shut
  over the weekend, up to a week — and is left alone until the next, so the header can say in one
  line what the whole column covers. Only this morning's edition is ever shown: yesterday's, still
  on file, is skeletons and a refresh rather than a stale page under a header that says otherwise.
- Subscribing is a row inside a repository: <kbd>→</kbd> on any repository row now offers
  **Subscribe to news** under *Pull requests* and *Issues*, and the same row unsubscribes. On a
  repository's own page the command sits under *Do*, since the links that point inside a repository
  have no row for the repository itself. The first subscription raises the column at once and the
  last lets it go, with the menu still open. The list travels with the profile in sync storage,
  capped at thirty.
- The column is read with the mouse and never takes the keyboard. Walking the chips inside the
  sentences with the arrows was tried and dropped: prose is not a list of rows to be a cursor in.
  So <kbd>Tab</kbd>, <kbd>←</kbd> and <kbd>→</kbd> stay with the links and the pull requests
  exactly as before, and the strip under the panel does not mention the news. Three columns need
  about 1280 px, where all three squeeze a little; below that the news steps out first, being the
  newer arrival, and below 980 px the menu is what it was.
- Each repository costs five plain REST requests a day — the repository itself, the commits on its
  default branch inside the window (a page more for every hundred beyond the first, up to three),
  the pull requests and issues that moved lately, the recent releases — so public repositories
  need no token at all. A private one is fetched with whichever
  saved token can see it, tried in the order that worked last time, anonymous last; a repository
  that fails keeps what it had, says why, and is asked again after a quarter of an hour rather than
  on every open. Everything is filtered against the window here, since only the commits endpoint
  takes an `until`.
- A **News** card in Settings: the switch, the edition hour as a slider shown as a clock, every
  subscribed repository with what the edition made of it — so many items, quiet, or the sentence
  GitHub gave — an **Unsubscribe** each, a field to add one by name or pasted URL, and a **Refresh
  now** that asks again without moving the window. It follows a subscription made in the menu
  without a reload.
- The lists scroll with the mouse. The overlay stops the wheel so the page behind cannot move, and
  it stopped it on the host — where every wheel inside the overlay had already been retargeted to
  the same element, so the links list, the pull requests and now the news never scrolled by wheel
  at all, only by keyboard. It listens on the menu layer now, where the real target is visible,
  and a wheel over a list with room left in that direction is let through; everything else — dead
  space, a list at its end — is still stopped, so nothing chains to the page.
- One mark on every waiting pull request. The filled and hollow diamonds meant private and public,
  as they do in the repository search — but that is a question about which repository is yours,
  and every row in the column already is. The verdict glyphs on the feedback lane stay.
- The strip under the panel is painted once more the moment the menu is in the page, so a fresh
  snapshot with nothing to refresh no longer leaves it silent about the columns until the cursor
  moves — that was true of the pull requests before this. In Settings, the token list shared a
  class with the placeholder table and inherited its two columns, so two tokens sat side by side;
  the list of subscribed repositories would have too.
- The release workflow now runs every test, not the two it had when there were two; the privacy
  notes say what the news asks GitHub for and what is kept, and the token card counts five calls
  rather than four.

## 2.4.0

- **Pull requests beside the menu.** With a token saved, a second column rises next to the panel:
  **feedback on your PRs** — approved, or changes requested — then the pull requests **waiting on
  you** for a review, then yours **waiting on others** with no answer yet. Every open pull request you
  are party to lands in exactly one lane. The search keeps focus; <kbd>→</kbd> on any row that is not a
  repository — or <kbd>Tab</kbd> on any row at all — crosses into the column, <kbd>↑</kbd><kbd>↓</kbd>
  walk the lanes, <kbd>↵</kbd> opens, <kbd>←</kbd> comes back, and typing anything drops straight
  back into the search with the character you typed, so there is nowhere to get stuck. It paints
  from its last snapshot the instant the menu opens and refreshes behind it — skeletons hold each
  lane's place until then, and the column's height is the panel's, so the slab never resizes as
  results land. Every lane shows everything it holds and the column scrolls when it has to; nothing
  is folded behind a *more* row or sent to a list page on GitHub. One GraphQL request carries both
  searches: the REST search cannot tell a reviewed
  pull request from an unreviewed one, and the obvious field for it is null on any repository
  without required reviews, so the latest review per reviewer is what gets read. Every saved token
  contributes, since a fine-grained one sees a single owner. Without a token there is no column, not
  an empty one asking for a token; below about 980 px there is no room and the menu is what it was.
- The toolbar icon carries the number waiting on you, refreshed every five minutes on an
  alarm, so you know before you press the key. The red `!` for a missing site grant still wins.
- A **Pull requests** card in Settings: switches for the column, the badge and whether drafts count,
  the three counts and when they were fetched, a **Refresh now**, and a plain word about fine-grained
  tokens — one never granted Pull requests shows the lanes empty rather than refusing, because GitHub
  returns less, not an error.
- The strip under the panel now shows keys as keys — <kbd>enter</kbd> open, <kbd>→</kbd> pull
  requests, <kbd>esc</kbd> close — and says only what is worth saying from wherever the cursor is,
  the pull requests included, which is why that column has no strip of its own. The panel's head
  reads *Links* now rather than the wordmark, and the list no longer repeats it; the repository name
  in the corner is gone too, since the links resolved against it regardless.
- `alarms` joins the permissions. The privacy notes now say what is asked of GitHub for the lanes and
  what is kept, and stop claiming the token is used for three calls when it is now four.

## 2.3.0

- A **Menu delay** slider in Settings sets the beat between the blade leaving the screen and the
  menu rising into the cut — from none at all, where the menu is there the instant the cut lands,
  to long enough for the dark to settle first. It was a fixed 140 ms on the aftermath's clock; the
  default still is, so nothing changes until the slider moves. Like the rest of the aftermath it
  stretches with **Speed**, and the settings page shows the wait that produces rather than the
  stored number, so the figure next to the slider is the one you are waiting through.
- **Preview chop** now raises an empty panel where the menu would be. The delay is a beat between
  two things and the preview only ever showed the first of them; it also stays until the menu has
  arrived, instead of leaving as soon as the dark had settled.

## 2.2.1

- Firefox 140 is now the minimum. The `data_collection_permissions` block in the Gecko settings —
  which AMO's disclosure form reads, and which has been mandatory there since November 2025 — is
  only understood from Firefox 140 on desktop, so claiming support back to 115 meant those users
  never got the browser's own consent prompt, and AMO warned about the mismatch on every upload.
  Nothing else changed: ESR 128 has been out of support for a year, ESR 115 survives only on
  Windows 7–8.1 and macOS 10.12–10.14, and github.com asks for a current browser regardless.

## 2.2.0

- The chop can be tuned in Settings: an **Effect** switch turns the whole animation off — the dot
  then opens the menu instantly — **Colour** is two rows of nine named swatches (steel is the
  classic blade, any other paints the blade, sparks and light), **Epicness** is one dial from a
  clean quiet cut to a full action scene — the glow deepens first, then sparks fly, then light
  bursts from the cut — and **Speed** runs from slow motion to double pace. Speed drives the slice
  itself; the aftermath — the dark spilling open, the light, the embers and the menu — trails it,
  keeping its slow drama however fast the blade is, and the two only fully agree at the slowest
  setting. A **Preview chop** button plays the result, saved or not, over the settings page itself
  and clears the moment the effect is over — there is no menu behind it to wait for.
- The chop itself now opens the page instead of fading it: the blade still crosses in the clear,
  but the dark then spills out of the finished cut — the line splits into two glowing edges that
  sweep apart and cool while the menu rises into the opening — where it used to fade in flat after
  a pause. The screen-wide flash is gone at every setting; at higher epicness the impact is a burst
  of light along the cut instead. `prefers-reduced-motion` still collapses everything to a plain
  fade regardless of the settings.
- The dot is now claimed before the content script touches a single extension API, so a tab that
  cannot reach the effect settings — the add-on reloaded underneath it, storage briefly gone —
  falls back to the default chop instead of ignoring the key. Registering the listener last meant
  any failure on the way to it left the page with no listener at all, and pressing `.` did nothing.

## 2.1.0

- A Chrome package alongside Firefox, which Edge and Brave take unchanged. Nothing in `src/` is
  conditional; the two disagree only about the background script, so `dev/build.mjs` derives a
  manifest per browser from the one in the repo root. Chrome refuses to load a Manifest V3 extension
  that mentions `background.scripts`, which is why one shared manifest was not enough.
- Both stores now call the extension "gitchop for GitHub" — consistent with Spacebar Review for
  GitHub, and findable next to the unrelated service that had the name first. Only the display name
  changed: the add-on ID, the AMO listing URL and every internal identifier stay as they were, so
  this arrives as an update rather than a second listing.
- Tagging a commit builds both packages and attaches them to a GitHub release. Store uploads stay
  manual; `dev/RELEASING.md` has the steps and what each store asks for.
- The settings page no longer says "Firefox" when explaining host permissions, since Chrome can have
  site access narrowed to "on click" and reaches the same card.
- Packaging now refuses to build when a manifest entry, an options-page `src`, or a relative
  `import` does not resolve. With no bundler between `src/` and the browser, those only used to
  surface after installing.
- `dev/package.sh` is gone; `node dev/build.mjs` replaces it.

## 2.0.0

- Classic tokens are the recommended path again: one token with `repo` and `gist` covers every
  organisation, with no owner approval to arrange. Fine-grained tokens remain supported as the
  tighter option.
- Tokens are sealed with AES-GCM under a random key before being written, so none is stored as
  recognisable `ghp_…` text. Documented as obfuscation rather than protection — the key is
  necessarily reachable by the extension.
- A token carrying a write-granting scope is labelled in the settings page.

## 1.9.1

- **Stop backup**, which leaves the gist and the tokens alone. Removing every token was previously
  the only way to stop syncing.

## 1.9.0

- Any number of tokens can be saved, because a fine-grained token has exactly one resource owner and
  two organisations therefore need two. The index builds from all of them and merges.
- A failing token no longer sinks the whole index build; the settings page names the one that failed.
- Gist operations find their own token by trying each and remembering which worked.

## 1.8.0

- Fine-grained token guidance, with the exact permissions spelled out.
- The settings page reports what a token actually is — fine-grained or classic, and a classic token's
  scopes, read from the `x-oauth-scopes` response header.
- The repository index reports **which accounts** it reached. A fine-grained token that was never
  granted an organisation returns a successful response with less in it, and this is the only way to
  see that.

## 1.7.0

- No row in the menu becomes a clickable link without passing a URL scheme check. Repository results
  and in-repo destinations previously set an `href` unvalidated.
- Data read back from the gist is treated as untrusted: sanitised, non-`http(s)` URLs dropped rather
  than stored, and the list capped.

## 1.6.1

- The toolbar icon shows a red `!` when Firefox has not granted access to `github.com`, and the
  settings page leads with a card that requests it. Without the grant the content script never runs
  and the `.` key does nothing, with nothing to explain it.

## 1.6.0

- **Private repository search.** GitHub's search will not return private repositories, so gitchop
  builds its own list from `/user/repos` and matches it locally — instantly, with no request per
  keystroke, ranked exact name over prefix over substring.
- A token is now independent of gist backup; private search no longer requires switching on sync.

## 1.5.0

- The panel is a fixed size and no longer resizes as you type. Reserving a block for the search
  results was not enough: filtering the links away moved far more.

## 1.4.0

- The list settles 110 ms after the last keystroke instead of rebuilding on every one, so a quickly
  typed word is one visual change rather than three. Any key that acts on the list flushes it first.

## 1.3.1

- `Manage links` is now `Settings`, matching the page it opens.

## 1.3.0

- The cut runs right to left, and faster: 240 ms.

## 1.2.0

- The version is shown at the foot of the settings page.

## 1.1.2

- Placeholder examples use `octocat/hello-world` rather than naming a real project.

## 1.1.1

- The in-repo list is Pull requests and Issues only.

## 1.1.0

- <kbd>→</kbd> on a repository opens the places inside it; <kbd>←</kbd> comes back. Works on saved
  links that point at a repository as well as on search results.

## 1.0.0

- First submission-ready build: data collection declared in the manifest, MIT licence, privacy
  policy, and a packaging script that stages a clean copy.
- Repositories belonging to accounts you have linked are ranked above the rest of GitHub.
