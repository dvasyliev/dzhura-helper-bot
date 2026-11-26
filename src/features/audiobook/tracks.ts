/** About 10 minutes of HolosTTS audio (≈770 characters a minute). */
export const TRACK_CHARS = 7500;

type Section = { title: string; text: string };

/**
 * Joins consecutive chapters into one track while it stays within TRACK_CHARS; a longer chapter is a track
 * of its own. A joined chapter's text starts with its title on a line of its own (unless the text already
 * does), which the voice reads with the same pause as any heading.
 */
export function groupChapters(chapters: Section[]): Section[] {
  const tracks: Section[] = [];
  for (const chapter of chapters) {
    const last = tracks.at(-1);
    const own = startsWithTitle(chapter)
      ? chapter.text
      : `${chapter.title}\n${chapter.text}`;
    if (last && last.text.length + 1 + own.length <= TRACK_CHARS) {
      last.text += `\n${own}`;
    } else {
      tracks.push({ ...chapter });
    }
  }
  return tracks;
}

function startsWithTitle({ title, text }: Section): boolean {
  return text.split("\n", 1)[0].trim() === title.trim();
}
