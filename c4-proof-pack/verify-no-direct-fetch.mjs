import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const SRC_DIR = path.join(PROJECT_ROOT, 'src');

const FILE_RE = /\.(js|jsx|ts|tsx)$/i;
const FORBIDDEN = [
  { name: 'fetch(', re: /\bfetch\s*\(/ },
  { name: 'axios.', re: /\baxios\s*\./ },
];

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listFiles(full)));
    } else if (e.isFile() && FILE_RE.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function findLineCol(text, index) {
  const upTo = text.slice(0, index);
  const lines = upTo.split(/\r?\n/);
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;
  return { line, col };
}

async function main() {
  let files;
  try {
    files = await listFiles(SRC_DIR);
  } catch (e) {
    console.error(`Failed to read src dir: ${SRC_DIR}`);
    console.error(String(e?.stack || e));
    process.exit(2);
  }

  const violations = [];

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');

    for (const { name, re } of FORBIDDEN) {
      const m = re.exec(content);
      if (!m) continue;

      const idx = m.index;
      const { line, col } = findLineCol(content, idx);
      violations.push({ file, name, line, col });
    }
  }

  if (violations.length) {
    console.error('Direct network calls are not allowed in src/**');
    for (const v of violations) {
      const rel = path.relative(PROJECT_ROOT, v.file);
      console.error(`- ${rel}:${v.line}:${v.col} contains ${v.name}`);
    }
    process.exit(1);
  }

  console.log('OK: no direct fetch/axios usage found in src/**');
}

main();
