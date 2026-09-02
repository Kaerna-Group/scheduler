import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const source = await readFile(
  new URL('../public/icons/app-icon.svg', import.meta.url),
);
const check = process.argv.includes('--check');
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['maskable-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  const target = new URL(`../public/icons/${name}`, import.meta.url);
  const png = new Resvg(source, { fitTo: { mode: 'width', value: size } })
    .render()
    .asPng();
  if (check) {
    const existing = await readFile(target);
    if (!existing.equals(png))
      throw new Error(`${name} is outdated. Run npm run icons:generate.`);
  } else {
    await writeFile(target, png);
  }
}
console.log(check ? 'PWA icons verified.' : 'PWA icons generated.');
