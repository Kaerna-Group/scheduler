import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appsScriptFiles,
  readAppsScriptSource,
} from './apps-script-sources.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'apps-script');
const outputDirectory = join(source, 'dist');
const files = appsScriptFiles();

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  join(outputDirectory, 'Code.gs'),
  `${readAppsScriptSource()}\n`,
  'utf8',
);
await writeFile(
  join(outputDirectory, 'appsscript.json'),
  await readFile(join(source, 'appsscript.json'), 'utf8'),
  'utf8',
);

console.log(
  `Bundled ${files.length} Apps Script files into apps-script/dist/Code.gs`,
);
