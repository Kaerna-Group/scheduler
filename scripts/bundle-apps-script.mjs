import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'apps-script');
const outputDirectory = join(source, 'dist');
const files = (await readdir(source))
  .filter((name) => name.endsWith('.gs'))
  .sort();

const sections = await Promise.all(files.map(async (name) =>
  `// ---- ${name} ----\n${await readFile(join(source, name), 'utf8')}`,
));

await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, 'Code.gs'), `${sections.join('\n\n')}\n`, 'utf8');
await writeFile(
  join(outputDirectory, 'appsscript.json'),
  await readFile(join(source, 'appsscript.json'), 'utf8'),
  'utf8',
);

console.log(`Bundled ${files.length} Apps Script files into apps-script/dist/Code.gs`);
