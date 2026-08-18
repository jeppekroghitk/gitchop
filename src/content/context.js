window.__gitchop = window.__gitchop || {};

(() => {
  const gc = window.__gitchop;

  const REF_SECTIONS = new Set([
    'tree', 'blob', 'blame', 'commits', 'raw', 'edit', 'new', 'find', 'deletes', 'compare',
  ]);
  const NUMBER_SECTIONS = new Set(['issues', 'pull', 'discussions']);

  /** First path segment on these pages is a GitHub feature, not an owner. */
  const NOT_OWNERS = new Set([
    'about', 'account', 'apps', 'codespaces', 'collections', 'contact', 'copilot', 'dashboard',
    'discussions', 'enterprise', 'events', 'explore', 'features', 'issues', 'login', 'logout',
    'marketplace', 'new', 'notifications', 'organizations', 'orgs', 'pricing', 'pulls', 'search',
    'security', 'sessions', 'settings', 'sponsors', 'stars', 'topics', 'trending', 'watching',
  ]);

  function branchFromDom() {
    const picker = document.querySelector('[data-hotkey="w"]');
    const text = (picker?.textContent || '').trim();
    if (!text || text.length > 120 || text.includes('\n')) return '';
    return text;
  }

  gc.readContext = function readContext() {
    const [owner, repo, section, ...rest] = location.pathname.split('/').filter(Boolean);
    const ctx = {
      owner: '',
      repo: '',
      repoFull: '',
      branch: '',
      path: '',
      number: '',
      url: location.href,
    };

    if (owner && !NOT_OWNERS.has(owner.toLowerCase())) {
      ctx.owner = owner;
      if (repo) {
        ctx.repo = repo;
        ctx.repoFull = `${owner}/${repo}`;
      }
    }

    if (!ctx.repoFull) return ctx;

    ctx.branch = branchFromDom();

    if (section && REF_SECTIONS.has(section) && rest.length) {
      const tail = rest.join('/');
      if (!ctx.branch) ctx.branch = rest[0];
      ctx.path = tail.startsWith(`${ctx.branch}/`)
        ? tail.slice(ctx.branch.length + 1)
        : rest.slice(1).join('/');
    }

    if (section && NUMBER_SECTIONS.has(section) && /^\d+$/.test(rest[0] || '')) {
      ctx.number = rest[0];
    }

    return ctx;
  };

  /** Fills {placeholders} from the page context; reports the ones it could not fill. */
  gc.resolveUrl = function resolveUrl(template, ctx) {
    const missing = [];
    const url = String(template).replace(/\{(\w+)\}/g, (token, key) => {
      const value = ctx[key];
      if (!value) {
        missing.push(key);
        return token;
      }
      if (key === 'url') return value;
      return encodeURIComponent(value).replace(/%2F/g, '/');
    });
    return { url, missing };
  };

  const REPO_PATH = /^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/?$/;

  /** `owner/repo` when a URL points at a repository's front page, otherwise null. */
  gc.repoFromUrl = function repoFromUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.host !== 'github.com' && parsed.host !== 'www.github.com') return null;
      if (parsed.search || parsed.hash) return null;
      const match = REPO_PATH.exec(parsed.pathname);
      if (!match || NOT_OWNERS.has(match[1].toLowerCase())) return null;
      return `${match[1]}/${match[2]}`;
    } catch {
      return null;
    }
  };

  gc.isSafeUrl = function isSafeUrl(url) {
    try {
      const probe = new URL(url);
      return probe.protocol === 'http:' || probe.protocol === 'https:';
    } catch {
      return false;
    }
  };

  gc.shortenUrl = function shortenUrl(url) {
    try {
      const parsed = new URL(url);
      const tail = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '');
      const label = parsed.host === 'github.com' ? tail : `${parsed.host}${tail}`;
      return label.replace(/^\//, '') || parsed.host;
    } catch {
      return url;
    }
  };
})();
