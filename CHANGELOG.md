# Changelog

Reconstructed from the development history; this project has no git history before 2.0.0 to derive
it from.

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
