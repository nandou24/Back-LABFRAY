'use strict';

// ====== Generar hash bcrypt sin almacenar contraseña ======
const bcrypt = require('bcryptjs');

function solicitarContrasena(etiqueta) {
  return new Promise((resolve, reject) => {
    const entrada = process.stdin;
    if (!entrada.isTTY || typeof entrada.setRawMode !== 'function') {
      reject(new Error('Ejecuta este script en una terminal interactiva.'));
      return;
    }

    let valor = '';
    const modoAnterior = Boolean(entrada.isRaw);
    let finalizado = false;

    function finalizar(error) {
      if (finalizado) return;
      finalizado = true;
      entrada.removeListener('data', capturar);
      entrada.setRawMode(modoAnterior);
      entrada.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(valor);
    }

    function capturar(chunk) {
      for (const tecla of chunk.toString('utf8')) {
        if (tecla === '\u0003') return finalizar(new Error('Operación cancelada.'));
        if (tecla === '\r' || tecla === '\n') return finalizar(null);
        if (tecla === '\u007f' || tecla === '\b') {
          valor = valor.slice(0, -1);
        } else if (tecla >= ' ' && tecla !== '\u007f') {
          valor += tecla;
        }
      }
    }

    process.stdout.write(etiqueta);
    entrada.setRawMode(true);
    entrada.resume();
    entrada.on('data', capturar);
  });
}

async function main() {
  const nueva = await solicitarContrasena('Nueva contraseña (no se muestra): ');
  const confirmar = await solicitarContrasena('Confirmar contraseña (no se muestra): ');

  if (nueva !== confirmar) throw new Error('Las contraseñas no coinciden.');
  if (nueva.length < 12) throw new Error('Utiliza una contraseña de al menos 12 caracteres.');

  const hash = await bcrypt.hash(nueva, 10);
  const coincide = await bcrypt.compare(nueva, hash);
  if (!coincide) throw new Error('Falló la verificación local del hash.');

  // ====== No imprimir ni guardar la contraseña ======
  process.stdout.write('\nHash bcrypt generado y verificado localmente:\n');
  process.stdout.write(`${hash}\n`);
  process.stdout.write('\nPega solo este hash en datosLogueo.passwordHash del registro autorizado.\n');
  process.stdout.write('No envíes el hash por chat ni lo incorpores a Git.\n');
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});
