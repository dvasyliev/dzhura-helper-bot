/** About 10 minutes of HolosTTS audio (≈770 characters a minute). */
export const TRACK_CHARS = 7500;

/** About 2 minutes: a shorter chapter joins the track before it. */
export const MIN_TRACK_CHARS = 1500;

/** HolosTTS reads about this many characters a minute. */
export const CHARS_PER_MINUTE = 770;

type Section = { title: string; text: string; level?: number };

const NUMBER =
  "\\d+|[ivxlcіхс]+|перш\\p{L}*|друг\\p{L}*|трет\\p{L}*|четверт\\p{L}*|п.ят\\p{L}*|шост\\p{L}*|сьом\\p{L}*|восьм\\p{L}*|дев.ят\\p{L}*|десят\\p{L}*";
/** Roman numerals may be typed with Cyrillic І, Х, С. «Chapter 2», «CHAPTER II», «Part 3», «Розділ 12», «Частина друга», «Книга перша», also «Chapter 1 | X». */
const NAMED_CHAPTER = new RegExp(
  `^(chapter|part|book|розділ|глава|частина|книга)\\s+(${NUMBER})(?![\\p{L}\\d])`,
  "iu",
);
/** «1. X», «1 | X», «1: X»; counts only inside a run 1, 2, 3, …, so numbered questions do not. */
const NUMBERED_TITLE = /^(\d+)\s*[.:|]/;
const MIN_NUMBERED_RUN = 3;
/** What follows the last chapter of a book. */
const BACK_MATTER =
  /^(afterword|epilogue|acknowledg(e)?ments?|about the author|copyright|appendix|bibliography|notes|післямова|епілог|подяки|про автора|копірайт|додаток|примітки|бібліографія)(?![\p{L}\d])/iu;

/**
 * Tracks follow the book's chapters. A top-level chapter is one track, however long, with all its sections. What
 * comes before the first one (about the book, introduction) is one track, and so is the back matter (afterword,
 * acknowledgements, about the author, copyright). A track under MIN_TRACK_CHARS joins the one before it. Top-level chapters are those on the highest level when the book
 * has levels, else those whose titles say so («Chapter 2», «3. Title», «Розділ XII»). With none found, short
 * chapters are joined up to TRACK_CHARS and a longer chapter is a track of its own.
 *
 * A joined chapter's text starts with its title on a line of its own (unless the text already does), which the
 * voice reads with the same pause as any heading.
 */
export function groupChapters(chapters: Section[]): Section[] {
  const { top, nested } = topLevel(chapters);
  const firstTop = top.indexOf(true);
  if (firstTop < 0) return joinShort(chapters);

  const tracks: Section[] = [];
  let inBackMatter = false;
  chapters.forEach((chapter, i) => {
    const back =
      i > firstTop &&
      (top[i] || !nested) &&
      BACK_MATTER.test(chapter.title.trim());
    const starts = i === 0 || (back ? !inBackMatter : top[i]);
    if (back) inBackMatter = true;
    else if (top[i]) inBackMatter = false;
    const last = tracks.at(-1);
    if (last && !starts) append(last, chapter);
    else tracks.push({ title: chapter.title, text: chapter.text });
  });
  return joinTiny(tracks);
}

/** A track under MIN_TRACK_CHARS joins the one before it. */
function joinTiny(tracks: Section[]): Section[] {
  const joined: Section[] = [];
  for (const track of tracks) {
    const last = joined.at(-1);
    if (last && track.text.length < MIN_TRACK_CHARS) append(last, track);
    else joined.push(track);
  }
  return joined;
}

/** Short chapters joined up to TRACK_CHARS; a longer chapter is a track of its own. */
function joinShort(chapters: Section[]): Section[] {
  const tracks: Section[] = [];
  for (const chapter of chapters) {
    const last = tracks.at(-1);
    if (last && last.text.length + 1 + withTitle(chapter).length <= TRACK_CHARS)
      append(last, chapter);
    else tracks.push({ title: chapter.title, text: chapter.text });
  }
  return tracks;
}

/** Which chapters are top-level: the highest level when levels differ, else the ones whose titles say so. */
function topLevel(chapters: Section[]): { top: boolean[]; nested: boolean } {
  const levels = chapters.map((c) => c.level ?? 1);
  const highest = Math.min(...levels);
  if (levels.some((level) => level !== highest))
    return { top: levels.map((level) => level === highest), nested: true };
  return { top: guessTopLevel(chapters), nested: false };
}

function guessTopLevel(chapters: Section[]): boolean[] {
  const named = chapters.map((c) => NAMED_CHAPTER.test(c.title.trim()));
  // Numbered titles that continue the run 1, 2, 3, …
  const run: number[] = [];
  chapters.forEach((c, i) => {
    const number = Number(c.title.trim().match(NUMBERED_TITLE)?.[1]);
    if (number === run.length + 1) run.push(i);
  });
  if (run.length >= MIN_NUMBERED_RUN) for (const i of run) named[i] = true;
  return named;
}

function append(track: Section, chapter: Section): void {
  track.text += `\n${withTitle(chapter)}`;
}

/** The chapter's text with its title as the first line. */
function withTitle(chapter: Section): string {
  return startsWithTitle(chapter)
    ? chapter.text
    : `${chapter.title}\n${chapter.text}`;
}

/** «Частина друга», «PART II», «Книга третя» alone on a line: the start of one of the book's own parts. */
const BOOK_PART = new RegExp(
  `^(part|book|частина|книга)\\s+(${NUMBER})$`,
  "iu",
);

/**
 * The book's own part each track is in («Частина друга», «PART II», «Книга третя»): a part starts at a track whose
 * first line is its heading, and lasts until the next; undefined before the first, or in a book without parts.
 */
export function bookParts(tracks: { text: string }[]): (string | undefined)[] {
  let part: string | undefined;
  return tracks.map((track) => {
    const first = track.text.split("\n", 1)[0]!.trim();
    if (BOOK_PART.test(first)) part = first;
    return part;
  });
}

function startsWithTitle({ title, text }: Section): boolean {
  return text.split("\n", 1)[0].trim() === title.trim();
}
