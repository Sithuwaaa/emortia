/* A read-only static server, for one job: letting the browser's canvas
   encode a WebP from a PNG that must never be committed. media/backgroud
   is gitignored because the sources are 2.6 MB each; the tools ship the
   WebP exports instead. There is no image encoder on this machine - no
   ImageMagick, no ffmpeg, no cwebp, no working Python - so the canvas is
   the only encoder available, and it needs an http origin to fetch from. */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html':'text/html', '.png':'image/png', '.webp':'image/webp',
                '.js':'text/javascript', '.css':'text/css' };
http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); res.end('no'); return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream',
                       'access-control-allow-origin': '*' });
  fs.createReadStream(f).pipe(res);
}).listen(Number(process.argv[3] || 8911), '127.0.0.1',
  () => console.log('serving ' + ROOT + ' on 127.0.0.1:' + (process.argv[3] || 8911)));
