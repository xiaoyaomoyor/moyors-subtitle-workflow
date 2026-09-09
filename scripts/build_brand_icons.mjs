// Render the Launcher SVG into native icons. Dev-only: uses the existing Playwright install.
// Run: node scripts/build_brand_icons.mjs && python scripts/build_macos_icon.py
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('web/launcher/logo.svg', root), 'utf8');
// Native icon files cannot follow the OS theme. This middle violet remains visible
// on both light and dark surfaces, without adding a plate behind the hollow mark.
const svg = source.replace('</style>', 'svg .cls-1 { fill: #7063a8; }</style>');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1, colorScheme: 'light' });
  await page.setContent('<style>html,body{margin:0;background:transparent}img{display:block;width:100vw;height:100vh}</style><img alt="">');
  await page.locator('img').evaluate((img, data) => { img.src = data; return img.decode(); },
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const frames = [];
  for (const size of [...sizes, 1024]) {
    await page.setViewportSize({width: size, height: size});
    const png = await page.screenshot({omitBackground: true});
    if (size === 1024) await writeFile(new URL('assets/msw-launcher.png', root), png);
    else frames.push(png);
  }
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  frames.forEach((png, index) => {
    const pos = 6 + index * 16;
    header[pos] = sizes[index] % 256;
    header[pos + 1] = sizes[index] % 256;
    header.writeUInt16LE(1, pos + 4);
    header.writeUInt16LE(32, pos + 6);
    header.writeUInt32LE(png.length, pos + 8);
    header.writeUInt32LE(offset, pos + 12);
    offset += png.length;
  });
  await writeFile(new URL('assets/maw.ico', root), Buffer.concat([header, ...frames]));
  console.log('Updated Launcher PNG and seven-size ICO from web/launcher/logo.svg.');
} finally {
  await browser.close();
}
