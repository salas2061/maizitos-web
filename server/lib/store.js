import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const paths = {
  dishes: resolve(process.cwd(), 'server/data/dishes.json'),
  availability: resolve(process.cwd(), 'server/data/availability.json'),
  reservations: resolve(process.cwd(), 'server/data/reservations.json'),
  users: resolve(process.cwd(), 'server/data/users.json'),
  passwordRequests: resolve(process.cwd(), 'server/data/password-change-requests.json'),
  emails: resolve(process.cwd(), 'server/storage/emails.json')
};

export async function readJson(name) {
  const raw = await readFile(paths[name], 'utf8');
  return JSON.parse(raw);
}

export async function writeJson(name, data) {
  await mkdir(dirname(paths[name]), { recursive: true });
  await writeFile(paths[name], `${JSON.stringify(data, null, 2)}\n`);
}
