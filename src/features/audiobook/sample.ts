// Voices the first N words of a book with every voice of its language, to compare them.
// The book is a folder in data/books; samples go to data/voice-samples/<language>/<voice>.mp3.
// Usage: npm run sample -- "Жуль Верн - Діти капітана Гранта" [words=150]
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEpub } from "../book/epub.ts";
import { bookLanguage } from "./text.ts";
import { voiceChapters, voicesFor } from "./voice.ts";

const [folder, wordsArg = "150"] = process.argv.slice(2);
if (!folder)
  throw new Error('Usage: npm run sample -- "<folder in data/books>" [words]');

const dir = path.join("data/books", folder);
const epub = (await readdir(dir)).find((f) =>
  f.toLowerCase().endsWith(".epub"),
);
if (!epub) throw new Error(`No .epub in ${dir}`);
const book = await parseEpub(await readFile(path.join(dir, epub)), epub);
const chapter = book.chapters[0];
if (!chapter) throw new Error("No chapters with text in this book");

const text = chapter.text.split(/\s+/).slice(0, Number(wordsArg)).join(" ");
console.log(`${book.title} / ${chapter.title}\n\n${text}\n`);

const language = bookLanguage(text);
if (!language || language === "ru")
  throw new Error("The book is neither Ukrainian nor English");
const audioDir = path.join("data/voice-samples", language);
const textDir = await mkdtemp(path.join(tmpdir(), "sample-")); // fresh, so the text is prepared anew
for (const voice of voicesFor(language)) {
  const chapters = [{ index: 0, name: voice.name, text }];
  const dictionary = path.join(dir, "stresses.txt");
  for await (const event of voiceChapters({
    voice,
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
