import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import rehypeImageDimensions, { readSize } from '../src/index.js';

// ---------------------------------------------------------------- fixtures

const publicDir = mkdtempSync(join(tmpdir(), 'rhid-'));
mkdirSync(join(publicDir, 'img'), { recursive: true });

function png(width, height) {
  const b = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8); // IHDR length
  Buffer.from('IHDR').copy(b, 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function jpeg(width, height) {
  const b = Buffer.alloc(24);
  b[0] = 0xff;
  b[1] = 0xd8; // SOI
  b[2] = 0xff;
  b[3] = 0xc0; // SOF0
  b.writeUInt16BE(17, 4); // segment length
  b[6] = 8; // precision
  b.writeUInt16BE(height, 7);
  b.writeUInt16BE(width, 9);
  return b;
}

function gif(width, height) {
  const b = Buffer.alloc(16);
  Buffer.from('GIF89a').copy(b);
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b;
}

function webp(width, height) {
  const b = Buffer.alloc(48);
  Buffer.from('RIFF').copy(b);
  Buffer.from('WEBP').copy(b, 8);
  Buffer.from('VP8 ').copy(b, 12);
  b.writeUInt16LE(width & 0x3fff, 26);
  b.writeUInt16LE(height & 0x3fff, 28);
  return b;
}

const svgPx = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"></svg>');
const svgViewBox = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"></svg>');
const svgPercent = Buffer.from('<svg width="100%" height="100%" viewBox="0 0 44 22"></svg>');

writeFileSync(join(publicDir, 'img', 'a.png'), png(640, 480));
writeFileSync(join(publicDir, 'img', 'b.jpg'), jpeg(800, 600));
writeFileSync(join(publicDir, 'img', 'c.gif'), gif(32, 32));
writeFileSync(join(publicDir, 'img', 'd.webp'), webp(1200, 630));
writeFileSync(join(publicDir, 'img', 'e.svg'), svgPx);
writeFileSync(join(publicDir, 'img', 'f.svg'), svgViewBox);
writeFileSync(join(publicDir, 'img', 'g.svg'), svgPercent);
writeFileSync(join(publicDir, 'img', 'broken.png'), Buffer.from('not an image at all'));

const img = (src, props = {}) => ({ type: 'element', tagName: 'img', properties: { src, ...props } });
const treeOf = (...children) => ({ type: 'root', children });

const run = (tree, options = {}) => rehypeImageDimensions({ publicDir, ...options })(tree);

// ---------------------------------------------------------------- readSize

test('readSize sniffs every supported format', () => {
  assert.deepEqual(readSize(png(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(readSize(jpeg(800, 600)), { width: 800, height: 600 });
  assert.deepEqual(readSize(gif(32, 32)), { width: 32, height: 32 });
  assert.deepEqual(readSize(webp(1200, 630)), { width: 1200, height: 630 });
  assert.deepEqual(readSize(svgPx), { width: 120, height: 60 });
});

test('readSize falls back to the SVG viewBox', () => {
  assert.deepEqual(readSize(svgViewBox), { width: 300, height: 150 });
  // percentage width/height are useless for layout, viewBox wins
  assert.deepEqual(readSize(svgPercent), { width: 44, height: 22 });
});

test('readSize returns null for junk instead of throwing', () => {
  assert.equal(readSize(Buffer.from('not an image')), null);
  assert.equal(readSize(Buffer.alloc(4)), null);
  assert.equal(readSize(null), null);
});

// ---------------------------------------------------------------- plugin

test('adds width/height to local images', () => {
  const tree = treeOf(img('/img/a.png'));
  run(tree);
  assert.equal(tree.children[0].properties.width, 640);
  assert.equal(tree.children[0].properties.height, 480);
});

test('first image is eager, the rest lazy', () => {
  const tree = treeOf(img('/img/a.png'), img('/img/b.jpg'), img('/img/c.gif'));
  run(tree);
  assert.equal(tree.children[0].properties.loading, 'eager');
  assert.equal(tree.children[1].properties.loading, 'lazy');
  assert.equal(tree.children[2].properties.loading, 'lazy');
});

test('eagerCount is configurable', () => {
  const tree = treeOf(img('/img/a.png'), img('/img/b.jpg'));
  run(tree, { eagerCount: 2 });
  assert.equal(tree.children[0].properties.loading, 'eager');
  assert.equal(tree.children[1].properties.loading, 'eager');
});

test('always sets decoding=async', () => {
  const tree = treeOf(img('/img/a.png'));
  run(tree);
  assert.equal(tree.children[0].properties.decoding, 'async');
});

test('existing attributes are kept by default', () => {
  const tree = treeOf(img('/img/a.png', { width: 10, height: 20, loading: 'lazy' }));
  run(tree);
  assert.equal(tree.children[0].properties.width, 10);
  assert.equal(tree.children[0].properties.loading, 'lazy');
});

test('overwrite: true replaces existing dimensions', () => {
  const tree = treeOf(img('/img/a.png', { width: 10, height: 20 }));
  run(tree, { overwrite: true });
  assert.equal(tree.children[0].properties.width, 640);
});

test('remote, data: and relative images are untouched', () => {
  const tree = treeOf(
    img('https://example.com/a.png'),
    img('data:image/png;base64,iVBOR'),
    img('relative/a.png')
  );
  run(tree);
  for (const node of tree.children) {
    assert.equal(node.properties.width, undefined);
    assert.equal(node.properties.loading, undefined);
  }
});

test('images nested inside other elements are found', () => {
  const tree = treeOf({
    type: 'element',
    tagName: 'figure',
    properties: {},
    children: [{ type: 'element', tagName: 'p', properties: {}, children: [img('/img/d.webp')] }],
  });
  run(tree);
  const node = tree.children[0].children[0].children[0];
  assert.equal(node.properties.width, 1200);
  assert.equal(node.properties.height, 630);
});

test('unreadable local images are skipped and reported once', () => {
  const warnings = [];
  const tree = treeOf(img('/img/broken.png'), img('/img/broken.png'), img('/img/missing.png'));
  run(tree, { onWarn: (m) => warnings.push(m) });
  assert.equal(tree.children[0].properties.width, undefined);
  assert.equal(tree.children[0].properties.loading, 'eager'); // still counted for loading
  assert.equal(warnings.length, 2, 'warns once per unique src');
  assert.match(warnings[0], /broken\.png/);
});

test('query strings and URL-encoded paths resolve', () => {
  writeFileSync(join(publicDir, 'img', 'space name.png'), png(11, 22));
  const tree = treeOf(img('/img/a.png?v=1'), img('/img/space%20name.png'));
  run(tree);
  assert.equal(tree.children[0].properties.width, 640);
  assert.equal(tree.children[1].properties.width, 11);
});
