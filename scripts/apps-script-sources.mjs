import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'apps-script',
);

export function appsScriptFiles() {
  // Explicit directories exclude dist and any downloaded/private deployment files.
  return ['', 'migrations', 'maintenance'].flatMap((directory) =>
    readdirSync(join(source, directory))
      .filter((name) => /^\d+_.*\.gs$/.test(name))
      .sort()
      .map((name) => (directory ? `${directory}/${name}` : name)),
  );
}

export function readAppsScriptSource() {
  return appsScriptFiles()
    .map(
      (name) =>
        `// ---- ${name} ----\n${readFileSync(join(source, name), 'utf8')}`,
    )
    .join('\n\n');
}
