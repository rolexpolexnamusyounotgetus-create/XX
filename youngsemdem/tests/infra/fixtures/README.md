# Tooling test fixtures (throwaway)

Owned by the tooling workstream. `tests/infra/tooling.test.js` uses them. Tests copy the sites to a
temp folder before running anything that writes files. These pages are not part of the site:
`tests/` is skipped by every tool, gets `noindex` in `_headers`, is disallowed in `robots.txt`,
and returns 404 on Netlify (netlify.toml).

- `site-good/`: a mini site that passes every `tools/check_site.js` check. It has a strict `_headers` CSP.
- `site-bad/`: a mini site with one of each problem the checker must report.
- `site-empty/`: a root with no pages, to check that the tools still run when no pages exist.
- `partials-site/`: pages with `<!-- @name -->` markers, for `tools/sync_partials.py` and `tools/make_sitemap.py`.
- `sw/`: pages that the service-worker tests serve at the site root, plus a page to open from `file://`.
