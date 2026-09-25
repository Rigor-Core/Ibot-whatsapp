import 'dotenv/config';
import crypto from 'crypto';
import { connectDB, closeDB, ensureIndexes, getCollections } from '../src/db/mongo.js';
import { createPanelUser, validatePassword } from '../src/routes/auth.middleware.js';

function argument(name) {
  const prefix = `--${name}=`;
  const item = process.argv.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : '';
}

const username = argument('username') || 'admin';
const suppliedPassword = argument('password');
function generatedPassword() {
  let password;
  do {
    password = crypto.randomBytes(24).toString('base64url');
  } while (validatePassword(password));
  return password;
}
const password = suppliedPassword || generatedPassword();

try {
  const db = await connectDB();
  await ensureIndexes(db);
  const collections = getCollections(db);
  const existing = await collections.users.findOne({ username });
  if (existing) throw new Error(`El usuario ${username} ya existe.`);
  await createPanelUser(collections, { username, password, role: 'owner' });
  console.log(`Propietario creado: ${username}`);
  if (!suppliedPassword) console.log(`Contraseña temporal: ${password}`);
  console.log('Guarda la contraseña en un gestor seguro.');
} catch (error) {
  console.error(`No se pudo crear el propietario: ${error.message}`);
  process.exitCode = 1;
} finally {
  await closeDB();
}
