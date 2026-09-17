# 2faguide-rehype-image-dimensions

[![npm version](https://img.shields.io/npm/v/2faguide-rehype-image-dimensions.svg)](https://www.npmjs.com/package/2faguide-rehype-image-dimensions)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

A [rehype](https://github.com/rehypejs/rehype) plugin that adds real
`width` / `height` / `loading` / `decoding` attributes to local markdown and MDX
images at build time — by reading the image headers off disk. Zero dependencies,
zero network calls, and zero JavaScript shipped to the browser.

Extracted from the build pipeline of **[2faguide.com](https://2faguide.com)**, where
it removed the layout shift caused by dozens of inline screenshots.

## Why

Images without dimensions make the page jump while they load. That is CLS, one of
the three Core Web Vitals. The fix is boring but easy to forget:

```html
<img src="/img/a.png" width="640" height="480" loading="lazy" decoding="async" />
```

This plugin writes those attributes for you, using the **real** pixel size read
from the file — not a guess, and not a runtime measurement.

## Install

```bash
npm install 2faguide-rehype-image-dimensions
```

Or from git:

```bash
npm install github:notbtc/2faguide-rehype-image-dimensions
```

## Usage

Astro (`astro.config.mjs`) — this is how 2faguide.com uses it:

```js
import { defineConfig } from 'astro/config';
import rehypeImageDimensions from '2faguide-rehype-image-dimensions';

export default defineConfig({
  markdown: {
    rehypePlugins: [rehypeImageDimensions],
  },
});
```

With options:

```js
rehypePlugins: [[rehypeImageDimensions, { publicDir: 'public', eagerCount: 2 }]];
```

Anywhere else in the unified pipeline:

```js
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeStringify from 'rehype-stringify';
import rehypeImageDimensions from '2faguide-rehype-image-dimensions';

const html = await unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeImageDimensions)
  .use(rehypeStringify)
  .process('<img src="/img/a.png">');
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `publicDir` | `'public'` | Directory that maps to `/` on the site. Relative paths resolve against `process.cwd()`. |
| `eagerCount` | `1` | How many leading images get `loading="eager"`. Everything after is `lazy`. |
| `overwrite` | `false` | Replace existing `width` / `height` instead of only filling gaps. |
| `onWarn` | `null` | `(message) => void` — called once per local image whose size could not be read. |

## Behaviour

- Only local, absolute-path images are touched (`/img/a.png`). Remote URLs,
  `data:` URIs and relative paths are left exactly as they are.
- Attributes you already wrote are respected; `decoding` and `loading` are only
  added when missing.
- Unreadable or missing files are skipped silently (or reported via `onWarn`) and
  never break the build.
- Results are cached per path, so a build with thousands of images stays fast.

## Supported formats

Dimensions are sniffed from the file header — no decoder, no image library:

| Format | Source of truth |
| --- | --- |
| PNG | IHDR |
| JPEG | SOF marker |
| GIF | logical screen descriptor |
| WebP | VP8 / VP8L / VP8X chunk |
| SVG | `width`/`height`, falling back to `viewBox` (percentage sizes use `viewBox`) |

## About 2faguide

[2faguide.com](https://2faguide.com) is the documentation site for **Free2FA**, a
free two-factor authenticator for WeChat users with encrypted cloud backup and a
recycle bin. This plugin is one of the small build-time tools we pulled out of it.

- Website: <https://2faguide.com>
- Online 2FA tool: <https://2faguide.com/online-totp/>
- Verification core: <https://github.com/notbtc/free2fa-tools-online-totp-core>

## License

[MIT](./LICENSE) © Free2FA
