/** The video id of the first YouTube link in `text`: youtube.com/watch?v=, youtu.be/, /shorts/, music.youtube.com. */
export function youtubeId(text: string): string | undefined {
  return text.match(/(?:youtube\.com\/(?:watch\?(?:\S*&)?v=|shorts\/)|youtu\.be\/)([\w-]{11})/)?.[1];
}
