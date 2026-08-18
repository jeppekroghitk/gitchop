# gitchop privacy

Short version: gitchop talks to GitHub and to nobody else. The author receives nothing.

There is no analytics, no telemetry, no crash reporting, no advertising, and no third-party service
of any kind beyond GitHub itself.

## What is stored, and where

| What | Where | Leaves the device? |
| --- | --- | --- |
| Your links (icon, label, URL) | `storage.sync` | Only to your own gist, and only if you connect one |
| Your GitHub token, if you add one | `storage.local` | Only to `api.github.com`, as an authorization header |
| A list of repositories you can access | `storage.local` | No — never sent anywhere |
| Which gist to use, and when it last synced | `storage.local` | No |

The repository list holds names, URLs, descriptions and the private and archived flags — the same
metadata GitHub shows on a repository's front page. It exists so that private repositories can be
found by typing, which GitHub's search will not do, and so that matching costs no request. It is
written on this machine and read on this machine. **Clear** in the settings page deletes it, and
removing the token deletes it too.

gitchop never reads repository contents, code, commits, issues or pull requests. It asks GitHub for
the list of repositories and nothing else.

The token is kept in `storage.local` rather than `storage.sync` specifically so that it is never
handed to Mozilla's sync servers. Every request to GitHub is made from the extension's background
script, so no web page — GitHub's included — is ever in a position to read it.

## What is sent to GitHub

**Repository search.** Typing three or more characters in the menu sends that text to GitHub's
search API (`api.github.com`) so the results can be shown. This happens as you type, debounced by
300 ms. If you have connected a token the request is authenticated, which raises the rate limit and
includes private repositories you have access to; without one the request is anonymous.

**Sync, only if you connect it.** Your link list is written to a secret gist on your own account, and
read back from it. That is the entire payload: the icons, labels and URLs you entered. Firefox asks
for your consent before this is switched on, and you can withdraw it in `about:addons`.

Nothing else is transmitted. gitchop does not read page content, does not track which pages you
visit, and does not send your browsing anywhere. It runs on `github.com` only.

## What GitHub then knows

Requests to GitHub are subject to
[GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
An authenticated request is associated with your account, as any use of your token is. A secret gist
is unlisted, not private — anyone with the URL can read it, so keep the gist id to yourself.

## Deleting it

- **Disconnect** in the options page forgets the token and stops syncing. The gist is left alone;
  delete it yourself at [gist.github.com](https://gist.github.com) if you want it gone.
- Revoke the token any time at
  [github.com/settings/tokens](https://github.com/settings/tokens) — this cannot be undone from
  inside the extension, and revoking is the right move if you ever suspect it leaked.
- Uninstalling the extension removes everything it stored locally, links and token both.

## Permissions, and why each one exists

| Permission | Why |
| --- | --- |
| `storage` | Keeping your links and settings |
| `https://github.com/*` | Running the menu on GitHub pages |
| `https://api.github.com/*` | Repository search and listing, and reading and writing your gist |

There is no `tabs` permission, no `<all_urls>`, and no host beyond those two.

## On the token's scope

**One classic token with `repo` and `gist`** is the simple path, and covers every organisation you
belong to with no approval from anyone. Leave `gist` off if you do not want the backup.

Be clear about the trade: classic tokens have **no read-only scope for private repositories**. `repo`
is the only scope that lists them, and it also grants write to every repository the account can reach.
gitchop only ever lists them — three calls, no others: who the account is, which repositories it can
see, and reading and writing the one gist. But the token itself can do more than gitchop does with it,
so put an expiry on it and revoke it if you stop using gitchop.

**Fine-grained tokens** grant less: **Metadata: Read-only** lists private repositories without any
write, and **Gists: Read and write** covers the backup. The catch is that a fine-grained token has
exactly one resource owner, so each organisation needs its own, and an organisation can require an
owner to approve them. gitchop accepts any number of tokens, so this works if you can get it.

Whichever you use, revoke at
[github.com/settings/tokens](https://github.com/settings/tokens) for classic tokens or
[github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens) for
fine-grained ones.

## How tokens are stored

Tokens are held in `storage.local`, deliberately not `storage.sync`, so they are never shipped to
Mozilla's sync servers. They are sealed with AES-GCM under a random key before being written, so a
token does not appear in the profile as `ghp_…` text.

**This is obfuscation, not protection, and the distinction matters.** gitchop must read the token
unattended, so the key sits beside the ciphertext; anyone who can read one can read the other. What it
defeats is accidental exposure — a grep over the profile, a backup scanner, a screenshot of storage, a
stray log line, another tool trawling for credential shapes. It does not defend against anyone with
access to the machine. Treat a token on a laptop as a token on a laptop.
