# Synced lyrics (LRC)

The Music page shows each song's lyrics and, if the file is time-synced,
highlights and auto-scrolls the current line as the song plays (karaoke
style). Clicking a line seeks the song to that moment.

## One file per song

The player looks for a file named after the song's slug:

| Song | File |
|------|------|
| Harana Hitha      | `harana-hitha.lrc` |
| Napuru Hitha      | `napuru-hitha.lrc` |
| Suwanda Vitharayi | `suwanda-vitharayi.lrc` |

(The slug is the title, lowercased, with spaces turned into hyphens —
the same rule used for the audio and art filenames.)

## Two kinds of file

**Synced (recommended)** — standard LRC, exactly what Musixmatch exports.
Each line starts with a `[mm:ss.xx]` timestamp:

```
[00:11.20] හාරනා හිත පාරනා වග දැනෙන මුත් මම අහනවා
[00:16.85] කාරණා ගතු වාරණා වන තෙක්ම හිස්තැන් සොයනවා
[00:22.40] රූරනා නෙතු නෑසෙනා තුරු ලඟම හිඳිමින් පිහිනවා
[00:28.10] මගෙ කුමාරිය සසර ඇති තෙක් නුඹට මා පෙම් කරනවා...
```

When timestamps are present the line highlights and scrolls in time with
the music, and lines become clickable to seek.

**Plain (no timing)** — just the lyric lines, one per line, no `[mm:ss]`.
These are shown statically (no highlight/scroll). The three files here
start out this way so lyrics appear right now; replace each with a synced
version whenever you're ready.

## Notes

- Metadata tags like `[ar:...]`, `[ti:...]`, `[by:...]` are ignored safely.
- Enhanced (word-level) LRC works too — the inline `<mm:ss.xx>` word marks
  are stripped and the line-level timing is used.
- Save the file, commit, and it goes live automatically.
