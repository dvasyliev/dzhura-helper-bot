// Voices the first N words of a book with every voice of the current TTS_PROVIDER, to compare them.
// The book is a folder in data/audiobook; samples go to data/voice-samples/<provider>/<voice>.mp3.
// Usage: npm run sample -- "Діти капітана Гранта" [words=150]
import { readdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.ts";
import { parseEpub } from "./epub.ts";
import { VOICES, voiceChapters } from "./voice.ts";

const [folder, wordsArg = "150"] = process.argv.slice(2);
if (!folder) throw new Error('Usage: npm run sample -- "<folder in data/audiobook>" [words]');

const dir = path.join("data/audiobook", folder);
const epub = (await readdir(dir)).find((f) => f.toLowerCase().endsWith(".epub"));
if (!epub) throw new Error(`No .epub in ${dir}`);
const book = await parseEpub(await readFile(path.join(dir, epub)));
const chapter = book.chapters[0];
if (!chapter) throw new Error("No chapters with text in this book");

const text = chapter.text.split(/\s+/).slice(0, Number(wordsArg)).join(" ");
console.log(`${book.title} / ${chapter.title}\n\n${text}\n`);

const outDir = path.join("data/voice-samples", config.ttsProvider);
for (const voice of VOICES) {
  for await (const result of voiceChapters(voice.id, outDir, [text])) {
    if (result.error) throw new Error(result.error);
    const out = path.join(outDir, `${voice.name}.mp3`);
    await rename(result.files![0], out);
    console.log(`Saved ${out}`);
  }
}
