/**
 * Sync `@superlexicon/sdk` (`package.json`, `README.md`, `LICENSE`, `src/**`) into
 * `../lexicon/web/packages/sdk` (or `SLX_WEB_SDK_DIR`) so Docker builds stay self-contained.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetRoot =
  process.env.SLX_WEB_SDK_DIR || path.resolve(sdkRoot, '../lexicon/web/packages/sdk');

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

fs.rmSync(targetRoot, { recursive: true, force: true });
fs.mkdirSync(targetRoot, { recursive: true });

for (const item of ['package.json', 'README.md', 'LICENSE', 'src']) {
  copyRecursive(path.join(sdkRoot, item), path.join(targetRoot, item));
}

console.log(`✓ Synced @superlexicon/sdk -> ${targetRoot}`);
process.exit(0);
