# partials/

Shared HTML snippets (site header, nav, footer, the paid-for disclaimer, common `<head>` tags) that
appear on many pages. There is no build step and no server-side include: every page carries the real
markup, so it works from `file://`, from `python3 -m http.server` and on any static host.
`tools/sync_partials.py` copies each snippet into every page.

## The marker convention

A partial is a file `partials/<name>.html`. The name uses letters, digits, `-` and `_`, and it
starts with a letter or digit. In a page, wrap the spot where the partial goes in a pair of
comments:

```html
<body>
  <!-- @header -->
  <!-- /@header -->
  <main id="main">...</main>
  <!-- @footer -->
  <!-- /@footer -->
</body>
```

Run the sync:

```sh
python3 tools/sync_partials.py           # update every page in place
python3 tools/sync_partials.py --check   # CI / pre-deploy: exit 1 if any page is out of date
python3 tools/sync_partials.py --diff    # show what would change
```

Everything between `<!-- @header -->` and `<!-- /@header -->` is replaced with the contents of
`partials/header.html`. The markers stay, so you can run the sync again whenever a partial changes.
A second run with nothing changed rewrites nothing.

- **Never edit the markup between markers in a page.** The next sync throws that edit away. Edit
  the partial and sync instead.
- When the opening marker sits on its own line, the inserted markup takes that line's indentation.
  When a marker is inline (`<p><!-- @year --><!-- /@year --></p>`), the partial goes in as is.
- Spacing inside a marker does not matter: `<!--@nav-->` and `<!-- @nav -->` both work.
- A marker that has no partial file gets a warning and the page is left as it is. An unclosed
  marker, a closing marker without an opening one, or a partial that includes itself is an error
  (exit code 2), and that page is not written.
- Partials may contain markers for other partials, for example a `header.html` that contains
  `<!-- @nav --><!-- /@nav -->`. They are expanded recursively.

## Which pages

Every `*.html` file under the site root, including sub-folders such as `events/index.html`. The
top-level `tools/`, `tests/`, `docs/`, `partials/`, `netlify/`, `functions/`, `vendor/`, `dist/`
and `build/` folders are skipped, and so are hidden folders and any `node_modules/`. To sync only
some pages, pass them: `python3 tools/sync_partials.py index.html about.html`.

## Per-page rewrites inside inserted markup

**`{{root}}`** becomes the relative path from the page to the site root: `""` for `index.html`
and `"../"` for `events/index.html`. Use it for every internal link and asset in a partial, so the
links work on `file://`, where `/about.html` would point at the root of the disk, and also in
sub-folders:

```html
<nav aria-label="Main">
  <a href="{{root}}index.html">Home</a>
  <a href="{{root}}events.html">Events</a>
  <a href="{{root}}join.html">Join</a>
</nav>
```

**`{{site}}`** becomes the absolute site URL with no trailing slash. It comes from `--site`, else
the `SITE_URL` environment variable, else `site.url` in `assets/js/config.js`. **`{{path}}`**
becomes the page's public path: `/` for `index.html`, `/about` for `about.html`, `/events/` for
`events/index.html`. Put them in a head partial so every page gets an absolute canonical URL,
which share crawlers need:

```html
<link rel="canonical" href="{{site}}{{path}}">
<meta property="og:url" content="{{site}}{{path}}">
```

While the demo has no `site.url`, these come out relative (`/about`), and the sync prints a
warning. After the real domain is set in config.js, run the sync again and every page is updated.

**`aria-current="page"`** is added to the link that points at the page being written, and
removed from every other link. Style the active link with CSS like
`nav a[aria-current="page"] { ... }`. You don't need a class. The rules:

- If the partial contains `<nav>` elements, only links inside them are considered. If it has no
  `<nav>`, every `<a href>` in the partial is considered.
- Matching resolves the href against the page and ignores `?query` and `#hash`. `./` and
  `index.html` both match `index.html`. A folder link (`events/`) matches `events/index.html`. An
  extensionless link (`about`) matches `about.html`. A root-relative link (`/about.html`) matches
  too, but don't use one in partials, because it breaks on `file://`.
- Add `data-no-current` to a link to leave it alone, for example a logo link to the home page.

## Ownership

The design team owns the partial files and the page markup. The tooling workstream owns
`tools/sync_partials.py` and this README. `tests/infra/tooling.test.js` covers the script.
