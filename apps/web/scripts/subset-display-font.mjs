// Builds public/assets/huangyou-display.woff2: the Chinese headline font, cut down to the
// characters the introduction page actually uses. Run it again after changing that page's copy:
//
//   node apps/web/scripts/subset-display-font.mjs path/to/ZCOOLQingKeHuangYou-Regular.ttf
//
// The full font (8 MB, SIL Open Font License) is not kept in the repository. Get it from
// https://github.com/google/fonts/tree/main/ofl/zcoolqingkehuangyou
import fs from 'node:fs/promises';
import path from 'node:path';
import subsetFont from 'subset-font';

const web = path.resolve(import.meta.dirname, '..');
const source = process.argv[2];
if (!source) throw new Error('Pass the path to ZCOOLQingKeHuangYou-Regular.ttf');

const page = await fs.readFile(path.join(web, 'src/shell/landing/Landing.tsx'), 'utf8');
// Every character outside ASCII: the Chinese text and its punctuation. Latin stays in Anton.
// eslint-disable-next-line no-control-regex -- matches the ASCII range on purpose
const text = [...new Set(page.replace(/[\x00-\x7f]/g, ''))].sort().join('');
const font = await subsetFont(await fs.readFile(source), text, { targetFormat: 'woff2' });
const target = path.join(web, 'public/assets/huangyou-display.woff2');
await fs.writeFile(target, font);
console.log(`${[...text].length} characters, ${(font.length / 1024).toFixed(1)} KB → ${target}`);
