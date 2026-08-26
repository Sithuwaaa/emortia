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

console.log('\nthe frame, and where the words sit on it');
{
  const sq = T.layout(3000, 3000), wide = T.layout(1280, 720);

  is('the square knows it is square',   sq.square, true);
  is('and the wide one does not',       wide.square, false);
  is('both keep a margin',              [sq.padX > 0, wide.padX > 0], [true, true]);
  /* the wide frame is short, so its title is a bigger share of the height -
     otherwise the same song reads half the size on YouTube as on the cover */
  is('the wide title is proportionally bigger',
     (wide.titleSize / 720) > (sq.titleSize / 3000), true);
  is('the title dwarfs the name',
     [sq.titleSize > sq.artistSize * 3, wide.titleSize > wide.artistSize * 3], [true, true]);
  is('a title has room before the edge',
     [sq.maxTextW < 3000 - sq.padX, wide.maxTextW < 1280 - wide.padX], [true, true]);
  is('the scrim does not reach the top',
     [sq.scrimH < 3000, wide.scrimH < 720], [true, true]);
  is('bigger when asked',
     T.layout(3000,3000,{titleScale:1.5}).titleSize > sq.titleSize, true);

  const sqS = T.typeSpots(sq, 3000, 1), wideS = T.typeSpots(wide, 720, 1);
  const onFrame = (y, h) => y > 0 && y < h;
  is('the square title is on the frame',  onFrame(sqS.titleYs[0], 3000), true);
  is('the square name is too',            onFrame(sqS.artistY, 3000), true);
  is('the wide title is on the frame',    onFrame(wideS.titleYs[0], 720), true);
  is('the wide name is too',              onFrame(wideS.artistY, 720), true);
  is('the name sits under the song',
     [sqS.artistY > sqS.titleYs[0], wideS.artistY > wideS.titleYs[0]], [true, true]);
  is('both start at the margin',          [sqS.x, wideS.x], [sq.padX, wide.padX]);
  is('and the type is low in the frame',
     [sqS.artistY / 3000 > 0.8, wideS.artistY / 720 > 0.75], [true, true]);

  /* A wrapped title must push its own top up and leave the name where it is,
     or a long song title walks the name off the bottom of the frame. */
  const one = T.typeSpots(sq, 3000, 1), two = T.typeSpots(sq, 3000, 2);
  is('two lines, the name has not moved',  two.artistY, one.artistY);
  is('the last line has not moved either', two.titleYs[1], one.titleYs[0]);
  is('and the first line went up',         two.titleYs[0] < one.titleYs[0], true);
  is('three lines still fit on the frame', T.typeSpots(sq,3000,3).titleYs[0] > 0, true);
  is('no lines still gives one spot',      T.typeSpots(sq,3000,0).titleYs.length, 1);
}

console.log('\nwrapping a long title');
{
  const measure = t => t.length * 10;
  is('a short title stays on one line', T.wrap('one two', 1000, measure), ['one two']);
  is('a long one breaks',               T.wrap('aaa bbb ccc ddd', 80, measure).length, 2);
  is('nothing wraps to nothing',        T.wrap('', 500, measure), []);
  is('and neither does nothing at all', T.wrap(null, 500, measure), []);
  is('one word too wide is still kept', T.wrap('supercalifragilistic', 50, measure), ['supercalifragilistic']);
  is('every word survives the break',
     T.wrap('one two three four five', 80, measure).join(' ').split(' ').length, 5);
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

console.log('\nwhat kind of file comes out');
{
  is('three to choose from',        T.FILE_TYPES.length, 3);
  /* JPEG first and JPEG by default: the frame is a photograph edge to edge,
     and the same picture is 7.75MB as PNG against 0.52MB as JPEG */
  is('JPEG is the default',         T.fileTypeById('nope').id, 'jpg');
  is('every one has a mime and an extension',
     T.FILE_TYPES.every(t => /^image\//.test(t.mime) && /^[a-z]{3,4}$/.test(t.ext)), true);
  is('and says what it is for',
     T.FILE_TYPES.every(t => typeof t.note === 'string' && t.note.length > 15), true);
  is('PNG is the lossless one',     T.fileTypeById('png').lossy, false);
  is('the other two are not',       [T.fileTypeById('jpg').lossy, T.fileTypeById('webp').lossy], [true, true]);

  /* quality is meaningless for PNG and must not be passed as a number, or
     some browsers take it as a hint and others ignore it inconsistently */
  is('PNG gets no quality',         T.qualityFor('png'), undefined);
  is('JPEG gets a sane default',    T.qualityFor('jpg'), 0.92);
  is('and takes what it is given',  T.qualityFor('jpg', 0.6), 0.6);
  is('too high is pulled back',     T.qualityFor('jpg', 4), 1);
  is('too low is pulled up',        T.qualityFor('webp', 0), 0.4);
  is('rubbish falls to the floor',  T.qualityFor('jpg', 'x'), 0.4);

  /* the extension has to follow the type, or the file is named .webp and is
     a PNG inside - which is what canvas does when it cannot encode a type */
  is('the name follows the type',
     T.FILE_TYPES.map(t => T.fileName('Thissema', 'cover', t.ext)),
     ['Thissema-3000x3000.jpg','Thissema-3000x3000.png','Thissema-3000x3000.webp']);
  is('and the thumbnail size too',
     T.fileName('Thissema', 'thumb', 'webp'), 'Thissema-1280x720.webp');

  /* canEncode has no canvas under node; it must say no rather than throw */
  is('no canvas, no encoding',      T.canEncode(null, 'image/webp'), false);
  is('and a thing that is not one', T.canEncode({}, 'image/webp'), false);
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
