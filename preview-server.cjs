/* Servidor local para pré-visualizar o site.
   Uso: dê dois cliques em preview.bat  (ou rode: node preview-server.js)
   Este arquivo é só para desenvolvimento — não precisa subir para a hospedagem. */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 4173;
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.js'  : 'text/javascript; charset=utf-8',
  '.svg' : 'image/svg+xml',
  '.png' : 'image/png',
  '.jpg' : 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico' : 'image/x-icon',
  '.xml' : 'application/xml',
  '.txt' : 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';

  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 - acesso negado');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h1>404</h1><p>Arquivo nao encontrado: ' + rel + '</p>');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('');
    console.log('  O servidor JA ESTA rodando nesta porta.');
    console.log('  Abra no navegador:  http://127.0.0.1:' + PORT + '/');
    console.log('');
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ============================================');
  console.log('   Site da Dra. Lais Caroline Hahmed');
  console.log('  ============================================');
  console.log('');
  console.log('   Abra no navegador:');
  console.log('   http://127.0.0.1:' + PORT + '/');
  console.log('');
  console.log('   Paginas:');
  console.log('   /politica-de-privacidade.html');
  console.log('   /termos-de-uso.html');
  console.log('');
  console.log('   Para parar: feche esta janela ou tecle Ctrl+C');
  console.log('');
});
