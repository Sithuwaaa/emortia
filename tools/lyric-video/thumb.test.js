/* thumb.test.js - where the artwork puts things.

     node tools/lyric-video/thumb.test.js
*/

const T = require('./thumb.js');

let pass = 0, fail = 0;
const show = v => typeof v === 'object' ? JSON.stringify(v) : String(v);
function is(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(52) + show(got) + (ok ? '' : '   want ' + show(want)));
}

console.log('\nthe two shapes');
{
  is('two of them',                 T.FORMATS.length, 2);
  is('the cover is what the stores ask for',
     (f => f.w + 'x' + f.h)(T.formatById('cover')), '3000x3000');
  is('the thumbnail is YouTube\'s own size',
     (f => f.w + 'x' + f.h)(T.formatById('thumb')), '1280x720');
  is('an unknown id falls back to the cover', T.formatById('nope').id, 'cover');
  is('square is square',            T.isSquare(3000, 3000), true);
  is('and 16:9 is not',             T.isSquare(1280, 720), false);
}

console.log('\nthe band under the picture');
{
  const sq = T.layout(3000, 3000), wide = T.layout(1280, 720);

  /* the whole point of the design: nothing sits over the photograph, so the
     picture and the band must exactly fill the frame and never overlap */
  is('the picture and the band fill the square',
     sq.photoH + sq.plinthH, 3000);
  is('and fill the wide one',
     wide.photoH + wide.plinthH, 720);
  is('the band starts where the picture stops',
     [sq.plinthTop === sq.photoH, wide.plinthTop === wide.photoH], [true, true]);

  /* a band that ate the picture would defeat it */
  is('the picture keeps most of the square',
     sq.photoH / 3000 > 0.7, true);
  is('and most of the wide one',
     wide.photoH / 720 > 0.72, true);

  is('the square stacks its type',   sq.stack, true);
  is('the wide one sets it on a line', wide.stack, false);
  is('both keep a margin',
     [sq.padX > 0, wide.padX > 0], [true, true]);

  /* the band can be pushed and pulled, within reason */
  is('a deeper band is allowed',
     T.layout(3000, 3000, {plinth:0.4}).plinthH, 1200);
  is('but not one that swallows the frame',
     T.layout(3000, 3000, {plinth:0.9}).plinthH, 1500);
  is('nor one too thin to hold the words',
     T.layout(3000, 3000, {plinth:0.01}).plinthH, 360);
  is('rubbish falls back to something sane',
     T.layout(3000, 3000, {plinth:'x'}).plinthH > 0, true);
}

console.log('\nwhere the words land');
{
  const sq = T.layout(3000, 3000), sqT = T.typeSpots(sq);
  const wide = T.layout(1280, 720), wideT = T.typeSpots(wide);

  /* every line has to be inside the band - one pixel above it and the letters
     are on the photograph, which is the thing this design exists to avoid */
  const inBand = (lay, y) => y > lay.plinthTop && y <= lay.plinthTop + lay.plinthH;
  is('the square title is on the band',   inBand(sq, sqT.titleY), true);
  is('the square artist is too',          inBand(sq, sqT.artistY), true);
  is('the wide title is on the band',     inBand(wide, wideT.titleY), true);
  is('the wide artist is too',            inBand(wide, wideT.artistY), true);

  is('stacked, the artist sits under the title', sqT.artistY > sqT.titleY, true);
  is('and starts at the margin',                 sqT.artistX, sq.padX);
  is('on one line, the artist goes right',       wideT.artistAlign, 'right');
  is('and the drawing decides where',            wideT.artistX, null);

  /* the title must not print above the top of its own band either */
  is('the square title clears the band top',
     sqT.titleY - sq.titleSize >= sq.plinthTop, true);
}

console.log('\nfitting the photograph');
{
  /* a wide photo into a square, and a tall photo into a wide frame: both are
     covered and centred, never squashed */
  const a = T.coverBox(4000, 2000, 1000, 1000);
  is('a wide photo covers the square',   [a.w >= 1000, a.h >= 1000], [true, true]);
  is('and keeps its shape',              +(a.w / a.h).toFixed(3), 2);
  is('centred left to right',            a.x, Math.round((1000 - a.w) / 2));

  const b = T.coverBox(1000, 2000, 1280, 720);
  is('a tall photo covers the wide frame', [b.w >= 1280, b.h >= 720], [true, true]);
  is('and keeps its shape',              +(b.w / b.h).toFixed(3), 0.5);

  const sqIn = T.coverBox(1500, 1500, 1000, 1000);
  is('a square into a square is exact',  [sqIn.w, sqIn.h, sqIn.x, sqIn.y], [1000, 1000, 0, 0]);

  /* the crop can be pulled up when the face is near the top */
  const top = T.coverBox(1000, 2000, 1000, 500, 0);
  const mid = T.coverBox(1000, 2000, 1000, 500, 0.5);
  is('focus at the top starts at the top', top.y, 0);
  is('and the middle sits lower',          mid.y < top.y, true);
  is('focus is clamped',                   T.coverBox(1000,2000,1000,500,9).y, T.coverBox(1000,2000,1000,500,1).y);

  is('nothing in, nothing out', T.coverBox(0,0,100,100), {x:0,y:0,w:100,h:100});
}

console.log('\nwhat the file is called');
{
  is('named after the song and the size',
     T.fileName('Harana Hitha', 'cover'), 'Harana-Hitha-3000x3000.png');
  is('and the thumbnail says so too',
     T.fileName('Harana Hitha', 'thumb'), 'Harana-Hitha-1280x720.png');
  /* Every title here is Sinhala. Stripping to a-z left all seven files called
     "artwork", which is no name at all when they are in the same folder. */
  is('a Sinhala title keeps its own letters',
     T.fileName('හරන හිත', 'cover'), 'හරන-හිත-3000x3000.png');
  is('and so does a mixed one',
     T.fileName('හරන හිත v2', 'thumb'), 'හරන-හිත-v2-1280x720.png');
  /* what a filesystem actually refuses, and nothing more */
  is('path separators and wildcards go',
     T.fileName('a/b\\c:d*e?f"g<h>i|j', 'thumb'), 'a-b-c-d-e-f-g-h-i-j-1280x720.png');
  is('and it cannot start or end on a dash or a dot',
     T.fileName('  --hello--  ', 'thumb'), 'hello-1280x720.png');
  is('an untitled song still gets a name',
     T.fileName('', 'cover'), 'artwork-3000x3000.png');
  is('and so does no title at all',
     T.fileName(null, 'cover'), 'artwork-3000x3000.png');
  is('a very long title is cut short',
     T.fileName('x'.repeat(200), 'thumb').length < 90, true);
  is('jpg if asked',
     T.fileName('Thissema', 'cover', 'jpg'), 'Thissema-3000x3000.jpg');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
