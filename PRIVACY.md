# gitchop privacy

Short version: gitchop talks to GitHub and to nobody else. The author receives nothing.

There is no analytics, no telemetry, no crash reporting, no advertising, and no third-party service
of any kind beyond GitHub itself.

## What is stored, and where

| What | Where | Leaves the device? |
| --- | --- | --- |
| Your links (icon, label, URL) | `storage.sync` | Only to your own gist, and only if you connect one |
| Your settings — the switches under Panels and Pull requests, and the chop's colour, epicness, speed and menu delay | `storage.sync` | Only to your own gist, and only if you connect one |
| Your GitHub token, if you add one | `storage.local`, sealed | Only to `api.github.com`, as an authorization header |
| Your sign-in, if you sign in with GitHub: an access token and the renewal token that replaces it | `storage.local`, sealed | The access token only to `api.github.com`, as an authorization header; the renewal token only to `github.com/login/oauth/access_token` |
| A sign-in under way: the code GitHub hands out for it | `storage.session`, in memory, gone when the browser closes | Only to `github.com/login/oauth/access_token`, to ask whether it was approved |
| Where gitchop's app is installed, as account names | `storage.local` | No — never sent anywhere |
| A list of repositories you can access | `storage.local` | No — never sent anywhere |
| Your open pull requests — title, number, repository, author, review state | `storage.local` | No — never sent anywhere |
| The repositories you subscribe to for news, as `owner/name`, and the edition hour | `storage.sync` | Only to your own gist, and only if you connect one |
| The day's news for them — commit counts and authors, the first line of the latest commit message, pull request, issue and release titles | `storage.local` | No — never sent anywhere |
| Your contributions — this year's count, the three whole years before it, and your login | `storage.local` | No — never sent anywhere |
| Which gist to use, and when it last synced | `storage.local` | No |
| Whether you finished or skipped the welcome, and whether you hid the menu's sign-in row | `storage.local` | No — never sent anywhere |

The repository list holds names, URLs, descriptions and the private and archived flags — the same
metadata GitHub shows on a repository's front page. It exists so that private repositories can be
found by typing, which GitHub's search will not do, and so that matching costs no request. It is
written on this machine and read on this machine. **Clear** in the settings page deletes it, and
removing the token deletes it too.

gitchop never reads repository contents or code. Beyond the repository list it asks GitHub for three
more things: the open pull requests you are party to, for the column beside the menu; what happened
lately in the repositories you have subscribed to, and only those, for the news column; and the
numbers your profile prints for the year's contributions and the three years before, for the head of
the menu. The first two are titles and states: the first line of a commit message, the title of a
pull request, an issue or a release, who and when. Never a diff, a file, or a comment. The third is
four counts and nothing else.

The token is kept in `storage.local` rather than `storage.sync` specifically so that it is never
handed to Mozilla's sync servers. Every request to GitHub is made from the extension's background
script, so no web page — GitHub's included — is ever in a position to read it.

## Signing in

**Sign in with GitHub** uses GitHub's device flow for gitchop's GitHub App, *gitchop for GitHub*.
The settings page asks GitHub, through the extension's background, for a short code
(`github.com/login/device/code`); you type that code at
[github.com/login/device](https://github.com/login/device) and approve it there, on GitHub's own page;
and while the code is on screen the background asks GitHub once every few seconds whether it has been
approved (`github.com/login/oauth/access_token`). gitchop never sees your password or your two-factor
code. There is no client secret: the device flow needs none, so none exists anywhere in gitchop.

What GitHub hands back is an access token that lasts eight hours and a renewal token that lasts
about six months. Both are sealed and kept in `storage.local` like any other token. When the access
token is close to running out, gitchop spends the renewal token at
`github.com/login/oauth/access_token` for a new pair; each renewal token works once. If GitHub
refuses a renewal, the sign-in is kept and marked *signed out* until you sign in again or remove it.

The app asks for **Metadata, Contents, Issues and Pull requests: read-only** on repositories, and
**Gists: read and write** on your account for the backup. It asks for nothing on organisations, and
its webhooks are switched off, so nothing is sent to the app or its owner when you use it. The
repository permissions work only in the accounts you install the app on, and only on the
repositories you choose there; elsewhere gitchop sees only what is public. The app's owner can see
which accounts have installed the app, as with any GitHub App, and receives nothing else.

## What is sent to GitHub

**Repository search.** Typing three or more characters in the menu sends that text to GitHub's
search API (`api.github.com`) so the results can be shown. This happens as you type, debounced by
300 ms. If you have connected a token the request is authenticated, which raises the rate limit and
includes private repositories you have access to; without one the request is anonymous.

**Pull requests, if you are signed in or a token is saved.** Every five minutes while the browser is open, and every time
the menu opens unless the snapshot is a few seconds old, gitchop asks GitHub's GraphQL API for two
things in one request: the open pull requests that request your review, and the open pull requests
you authored.
What comes back — titles, numbers, repositories, authors, review states, timestamps — is kept in
`storage.local` for the menu and the toolbar badge, and is never sent anywhere. Switching the pull
requests off in Settings stops the requests; removing the token deletes the snapshot.

**What is left of GitHub's budgets.** Every answer from GitHub carries its rate limit headers — how
much of the hour's allowance remains for the budget the request was charged to, and when it turns.
gitchop reads those off the answers it already gets, and keeps the latest per budget and per token
login in `storage.local` for the gauge in the corner of the menu. No request is made for them, and
they are never sent anywhere.

**News, only for repositories you subscribe to.** Once a day at the edition hour set in Settings,
when the browser starts with that day's edition not yet made up, and when the menu opens the same
way, gitchop asks GitHub's REST API five things per subscribed repository: the repository itself,
the commits on its default branch inside the window, the pull requests and issues that changed
lately, and its recent releases. A public repository is asked about anonymously when no saved token
can see it; a private one is asked about with the token that can. What comes back is cut down to
counts, names, titles and timestamps, kept in `storage.local` for the menu, and never sent anywhere.
Unsubscribing drops the repository from the next edition; switching the news off in Settings stops
the requests; removing the last token deletes the edition, so what a token saw of a private
repository does not outlive it.

**Contributions, if you are signed in or a token is saved.** When the menu opens with a snapshot older than five minutes,
or one from another year, and when **Refresh now** in Settings asks, gitchop asks GitHub's GraphQL
API in one request for four numbers: the total on your contribution calendar from January the 1st to
now, and the total for each of the three whole years before, together with your login and the date
the account was made — which says which of those years existed. Every saved token is asked and the
highest answer for this year kept. The numbers are kept in `storage.local` for the menu and are
never sent anywhere. Switching the contributions off in Settings stops the requests; removing the
last token deletes the snapshot.

**Backup, only if you connect it.** Your links and settings are written to a secret gist on your own
account, and read back from it. That is the entire payload: the icons, labels and URLs you entered,
the repositories you subscribe to for news and the edition hour, and the position of every switch
and dial in Settings. Never a token, and nothing gitchop fetched from GitHub — not the repository
list, the pull requests, the news or the contributions. Firefox asks for your consent before this is
switched on, and you can withdraw it in `about:addons`.

Nothing else is transmitted. gitchop does not read page content, does not track which pages you
visit, and does not send your browsing anywhere. It runs on `github.com` only.

## What GitHub then knows

Requests to GitHub are subject to
[GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
An authenticated request is associated with your account, as any use of your token is. A secret gist
is unlisted, not private — anyone with the URL can read it, so keep the gist id to yourself.

## Deleting it

- **Remove** beside a token, or **Sign out** for the sign-in, forgets it in the settings page; with
  nothing left, syncing stops. The gist is left alone; delete it yourself at
  [gist.github.com](https://gist.github.com) if you want it gone.
- Signing out forgets the sign-in here. To end it on GitHub too, revoke gitchop for GitHub at
  [github.com/settings/applications](https://github.com/settings/applications), and uninstall the app
  from each account under that account's settings, *Applications* (or *GitHub Apps* for an
  organisation).
- Revoke the token any time at
  [github.com/settings/tokens](https://github.com/settings/tokens) — this cannot be undone from
  inside the extension, and revoking is the right move if you ever suspect it leaked.
- Uninstalling the extension removes everything it stored locally, links and token both.

## Permissions, and why each one exists

| Permission | Why |
| --- | --- |
| `storage` | Keeping your links and settings |
| `alarms` | Refreshing the pull requests every few minutes, so the badge is right before the key is pressed, and making up the news edition once a day |
| `https://github.com/*` | Running the menu on GitHub pages, and signing in (`github.com/login/device/code`, `github.com/login/oauth/access_token`) |
| `https://api.github.com/*` | Repository search and listing, the pull requests, the news, the year's contributions, where gitchop's app is installed, and reading and writing your gist |

There is no `tabs` permission, no `<all_urls>`, and no host beyond those two.

## On the token's scope

**Signing in with GitHub** is the recommended path: read-only on repositories, and only in the
accounts that install the app. A personal access token is the way for an organisation that will not
install it.

**One classic token with `repo`, `gist` and `read:user`** covers every organisation you belong to
with no approval from anyone. Leave `gist` off if you do not want the backup. `read:user` is what lets
GitHub count your private contributions in the year's number; without it, and with a fine-grained
token or a sign-in, the count is what that token is allowed to see.

Be clear about the trade: classic tokens have **no read-only scope for private repositories**. `repo`
is the only scope that lists them, and it also grants write to every repository the account can reach.
gitchop only ever reads with it — six calls, no others: who the account is, which repositories it
can see, which open pull requests are yours or want your review, what happened lately in the
repositories you subscribe to, how many contributions this year and the three before have on your
calendar, and reading and writing the one gist. But the token itself can do
more than gitchop does with it, so put an expiry on it and revoke it if you stop using gitchop.

**Fine-grained tokens** grant less: **Metadata: Read-only** lists private repositories without any
write, **Pull requests: Read-only** is what the pull request lanes need, **Contents**, **Pull
requests** and **Issues: Read-only** together are what the news needs for a private repository
(public ones need nothing), and **Gists: Read and write** covers the backup. The catch is that a
fine-grained token has
exactly one resource owner, so each organisation needs its own, and an organisation can require an
owner to approve them. gitchop accepts any number of tokens, so this works if you can get it.

Whichever you use, revoke at
[github.com/settings/tokens](https://github.com/settings/tokens) for classic tokens,
[github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens) for
fine-grained ones, or [github.com/settings/applications](https://github.com/settings/applications)
for the sign-in.

## How tokens are stored

Tokens are held in `storage.local`, deliberately not `storage.sync`, so they are never shipped to
Mozilla's sync servers. They are sealed with AES-GCM under a random key before being written, so a
token does not appear in the profile as `ghp_…` text. A sign-in's renewal token is sealed the same way.

**This is obfuscation, not protection, and the distinction matters.** gitchop must read the token
unattended, so the key sits beside the ciphertext; anyone who can read one can read the other. What it
defeats is accidental exposure — a grep over the profile, a backup scanner, a screenshot of storage, a
stray log line, another tool trawling for credential shapes. It does not defend against anyone with
access to the machine. Treat a token on a laptop as a token on a laptop.
