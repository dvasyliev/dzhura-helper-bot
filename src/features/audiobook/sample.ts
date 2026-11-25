// Voices the first N words of a book with every voice of the current TTS_PROVIDER, to compare them.
// The book is a folder in data/audiobook; samples go to data/voice-samples/<provider>/<voice>.mp3.
// Usage: npm run sample -- "Жуль Верн - Діти капітана Гранта" [words=150]
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "../../config.ts";
import { parseEpub } from "./epub.ts";
import { VOICES, voiceChapters } from "./voice.ts";

const [folder, wordsArg = "150"] = process.argv.slice(2);
if (!folder)
  throw new Error(
    'Usage: npm run sample -- "<folder in data/audiobook>" [words]',
  );

const dir = path.join("data/audiobook", folder);
const epub = (await readdir(dir)).find((f) =>
  f.toLowerCase().endsWith(".epub"),
);
if (!epub) throw new Error(`No .epub in ${dir}`);
const book = await parseEpub(await readFile(path.join(dir, epub)), epub);
const chapter = book.chapters[0];
if (!chapter) throw new Error("No chapters with text in this book");

const text = chapter.text.split(/\s+/).slice(0, Number(wordsArg)).join(" ");
console.log(`${book.title} / ${chapter.title}\n\n${text}\n`);

const audioDir = path.join("data/voice-samples", config.ttsProvider);
const textDir = await mkdtemp(path.join(tmpdir(), "sample-")); // fresh, so the text is prepared anew
for (const voice of VOICES) {
  const chapters = [{ index: 0, name: voice.name, text }];
  const dictionary = path.join(dir, "словник наголосів.txt");
  for await (const event of voiceChapters({
    voiceId: voice.id,
    textDir,
    audioDir,
    dictionary,
    chapters,
  })) {
    if ("report" in event) continue;
    if (event.error) throw new Error(event.error);
    console.log(`Saved ${event.files!.join(", ")}`);
  }
}
