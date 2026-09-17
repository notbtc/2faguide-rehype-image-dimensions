/**
 * 2faguide-rehype-image-dimensions
 *
 * A rehype plugin that adds width / height / loading / decoding to local images
 * in markdown & MDX at build time, by reading the real byte headers from disk.
 *
 *   - width / height  -> browser can reserve space, kills layout shift (CLS)
 *   - loading         -> first N images eager, the rest lazy
 *   - decoding=async  -> decoding never blocks the main thread
 *
 * Zero dependencies, no network access, no image processing. Runs once at build
 * time and ships zero JavaScript to the browser.
 *
 * Usage (astro.config.mjs):
 *   import rehypeImageDimensions from '2faguide-rehype-image-dimensions';
 *   export default defineConfig({
 *     markdown: { rehypePlugins: [[rehypeImageDimensions, { publicDir: 'public' }]] },
 *   });
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

// ---------------------------------------------------------------- byte sniffing

function pngSize(b) {
  if (b.length < 24) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gifSize(b) {
  if (b.length < 10) return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function jpegSize(b) {
  let p = 2;
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) {
      p += 1;
      continue;
    }
    const marker = b[p + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan
    const len = b.readUInt16BE(p + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(p + 5), width: b.readUInt16BE(p + 7) };
    }
    p += 2 + len;
  }
  return null;
}

function webpSize(b) {
  if (b.length < 30) return null;
  const fmt = b.toString('ascii', 12, 16);
  if (fmt === 'VP8 ') {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (fmt === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fmt === 'VP8X') {
    return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return null;
}

function svgSize(b) {
  const head = b.toString('utf8', 0, Math.min(b.length, 4096));
  if (!/<svg[\s>]/i.test(head)) return null;

  const attr = (name) => {
    const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(head);
    return m ? m[1].trim() : null;
  };
  const num = (v) => {
    if (!v) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  // Explicit width/height win, unless they are relative ("100%") — then use viewBox.
  const w = num(attr('width'));
  const h = num(attr('height'));
  if (w && h && !/%/.test(attr('width') + attr('height'))) return { width: Math.round(w), height: Math.round(h) };

  const vb = attr('viewBox');
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return { width: Math.round(parts[2]), height: Math.round(parts[3]) };
    }
  }
  return null;
}

/** Sniff the dimensions out of the first bytes of an image. No decoder involved. */
export function readSize(buf) {
  if (!buf || buf.length < 8) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return pngSize(buf);
  if (buf[0] === 0xff && buf[1] === 0xd8) return jpegSize(buf);
  if (buf.toString('ascii', 0, 3) === 'GIF') return gifSize(buf);
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return webpSize(buf);
  const text = buf.toString('utf8', 0, Math.min(buf.length, 16)).trimStart();
  if (text.startsWith('<svg') || text.startsWith('<?xml')) return svgSize(buf);
  return null;
}

// ---------------------------------------------------------------- tree walking

function walk(node, visit) {
  if (!node) return;
  visit(node);
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) walk(child, visit);
  }
}

const isRemote = (src) => /^[a-z][a-z0-9+.-]*:\/\//i.test(src);

/**
 * @param {object} [options]
 * @param {string} [options.publicDir]   Directory that maps to `/` on the site. Default `'public'`.
 * @param {number} [options.eagerCount]  How many leading images get loading="eager". Default `1`.
 * @param {boolean} [options.overwrite]  Replace existing width/height attributes. Default `false`.
 * @param {(msg: string) => void} [options.onWarn] Called when a local image cannot be measured.
 */
export default function rehypeImageDimensions(options = {}) {
  const {
    publicDir = 'public',
    eagerCount = 1,
    overwrite = false,
    onWarn = null,
  } = options || {};

  const base = isAbsolute(publicDir) ? publicDir : resolve(process.cwd(), publicDir);
  const cache = new Map();
  const missing = new Set();

  function measure(urlPath) {
    if (cache.has(urlPath)) return cache.get(urlPath);
    let dim = null;
    try {
      const rel = decodeURIComponent(urlPath.replace(/^\//, '').split(/[?#]/)[0]);
      const file = join(base, rel);
      if (!file.startsWith(base)) throw new Error('path escapes publicDir');
      dim = readSize(readFileSync(file));
    } catch {
      dim = null;
    }
    cache.set(urlPath, dim);
    return dim;
  }

  return function transformer(tree) {
    let seen = 0;
    walk(tree, (node) => {
      if (!node || node.type !== 'element' || node.tagName !== 'img') return;
      const props = node.properties || (node.properties = {});
      const src = typeof props.src === 'string' ? props.src : '';

      // only local, absolute-path images — remote URLs and data: URIs are left alone
      if (!src || src.startsWith('data:') || isRemote(src) || !src.startsWith('/')) return;

      const dim = measure(src);
      if (dim) {
        if (overwrite || (props.width == null && props.height == null)) {
          props.width = dim.width;
          props.height = dim.height;
        }
      } else if (!missing.has(src)) {
        missing.add(src);
        if (onWarn) onWarn(`could not read dimensions for ${src}`);
      }

      if (props.decoding == null) props.decoding = 'async';
      if (props.loading == null) props.loading = seen < eagerCount ? 'eager' : 'lazy';
      seen += 1;
    });
  };
}
