import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePassword } from '../src/routes/auth.middleware.js';

test('exige contraseñas robustas para nuevas cuentas', () => {
  assert.match(validatePassword('corta'), /12 caracteres/);
  assert.match(validatePassword('solominusculas123'), /mayúsculas/);
  assert.match(validatePassword('SOLOMAYUSCULAS123'), /minúsculas/);
  assert.match(validatePassword('SinNumerosSegura'), /números/);
  assert.equal(validatePassword('ClaveSegura2026'), null);
});
