# gitchop

Press <kbd>.</kbd> on GitHub for your own links and instant repository search.

**[Install for Firefox](https://addons.mozilla.org/en-US/firefox/addon/gitchop/)**

If the menu does not open, allow access to `github.com` in `about:addons` → gitchop → Permissions,
then reload the tab. Firefox does not grant that at install.

## Keys

| Key | Does |
| --- | --- |
| <kbd>.</kbd> | Open the menu |
| type | Filter your links; 3 characters or more also searches repositories |
| <kbd>↑</kbd> <kbd>↓</kbd> | Move |
| <kbd>→</kbd> | Go inside a repository — its pull requests or issues |
| <kbd>←</kbd> | Back out |
| <kbd>↵</kbd> | Open |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>↵</kbd> | Open in a new tab |
| <kbd>Esc</kbd> | Close |

`Add this page` and `Settings` are rows in the list; type `add` or `settings` to reach them.

This takes over GitHub's own <kbd>.</kbd> shortcut, which normally opens github.dev.

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

## Private repositories

GitHub's search does not return private repositories. To find them, add a GitHub token in Settings
and press **Build index** — gitchop then keeps its own list of the repositories your token can reach,
and matches it locally.

A classic token with the `repo` scope is simplest and covers every organisation. A fine-grained token
with **Metadata: read-only** grants less but covers one organisation each; add as many as you need.

## Backup

Links live in the browser profile, and go with the extension if you remove it. Connect a secret gist
in Settings and every change is written there as a new revision.

[PRIVACY.md](PRIVACY.md) covers what is stored and what is sent to GitHub.

## Development

No build step — the files in `src/` are what runs.

```sh
node dev/context.test.mjs && node dev/repos.test.mjs   # tests
./dev/package.sh                                       # build gitchop.xpi, needs only zip
open dev/harness.html                                  # the menu, without installing
```

[Changelog](CHANGELOG.md) · MIT
