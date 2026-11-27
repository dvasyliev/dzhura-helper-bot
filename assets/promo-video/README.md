# Promo video

`dzhura-promo.mp4` ([download](https://github.com/dvasyliev/dzhura-helper-bot/releases/download/promo-video/dzhura-promo.mp4)): a 1:32, 1920×1080 motion-graphics video of the bot with music and UI sounds, English texts, no voice-over. Its source is `index.html`, a [HyperFrames](https://www.npmjs.com/package/hyperframes) composition: plain HTML and CSS plus one paused GSAP timeline that HyperFrames seeks frame by frame.

## Scenes

| Time | Scene (`<section id>`) | What it shows |
| --- | --- | --- |
| 0–4 s | `#intro` | The bot's avatar with a Telegram badge, "Dzhura" |
| 4–15 s | `#over` | The three features one at a time in the middle, animated like [the README banner](../repo-banner.svg), each shrinking into a tile |
| 15–35 s | `#c1` | YouTube video → Summary → Voice-over |
| 35–57 s | `#c2` | Book → Translation → Audiobook |
| 57–79 s | `#c3` | YouTube song → Karaoke |
| 79–85 s | `#lib` | The group's topic list |
| 85–92 s | `#outro` | Tiles and the GitHub link |

Each use case has two drawn Telegram windows: the private chat with the bot on the left (the user sends everything there; statuses and "✅ Done" land there) and a topic of the group on the right (results land there; the summary card's buttons are pressed there). A white `#wipe` panel with the case number runs between scenes. The times shift if a scene gets longer: each case starts where the previous one ended (`T` in the script).

## Rules the video keeps

- Every message, button and status copies the bot's real text: read it in `src/features/` and `src/lib/library/` before changing a scene. Voices are "👩 Woman (UA)" / "👨 Man (UA)", never names.
- The group is "Books, Audiobooks, Karaoke", with the avatars from [`assets/`](..) (`bot-avatar.svg`, `group-avatar.svg`, inlined as `BOT_SVG` and `GRP_SVG`).
- Made-up AI topics, links masked as `youtu.be/xxxxx`, colours of the banner (`#4A5BD4`, `#C9CEF3`, white).

## Editing

The script builds the case scenes from small template helpers (`win`, `band`, `kb`, `sw`) and then the timeline:

- `pop(sel, t, from)`: an element appears at second `t`.
- `Case(section)` gives `dm` and `gr` (the two windows) with `say(key, t)` (scroll the feed and pop the message `data-k="key"`), `status(text, t)` (the header's "typing…"), `glow(t)`; and `click(window, el, t)`, `type(text, t)`, `flow(t)` (a result flying to the group), `step(i, t)` (the step chips).
- `.sw` is a message or keyboard with several versions stacked; `swap(sw, i, t)` changes to version `i`. Its width is fixed to the widest version so text is never cut.
- Layout is measured while the script builds the timeline, so a later state is tweened with `immediateRender: false` and the DOM is reset to the first state at the end.

## Commands

Run from this folder. Needs Node, Google Chrome and ffmpeg; HyperFrames runs through `npx`.

```bash
npx --yes hyperframes@0.7.26 lint                      # composition errors
npx --yes hyperframes@0.7.26 validate                  # runs it in headless Chrome, shows console errors
npx --yes hyperframes@0.7.26 snapshot --output snaps --at 6,22,45,75   # stills + a contact sheet, to check frames
npx --yes hyperframes@0.7.26 render --quality high --output dzhura-promo-silent.mp4   # ~1.5 min
python3 sound/mix.py dzhura-promo-silent.mp4 dzhura-promo.mp4   # adds the soundtrack
```

Two lint warnings are expected (overlapping tweens on `#lib .win`, file size). Look at the snapshot frames before rendering. `snaps*/` and the mp4s are git-ignored: the video is kept in the [`promo-video` release](https://github.com/dvasyliev/dzhura-helper-bot/releases/tag/promo-video), so new renders do not grow the repo. Publish a new render there:

```bash
gh release upload promo-video dzhura-promo.mp4 --clobber   # first time: gh release create promo-video dzhura-promo.mp4 --title "Promo video" --notes "Dzhura promo"
```

## Sound

HyperFrames renders a silent video; `sound/mix.py` puts the soundtrack on it with ffmpeg.

- `sound/music.mp3`: [ElevenLabs Music](https://elevenlabs.io/docs/api-reference/music/compose), instrumental, prompt "Bright modern tech product promo, instrumental, 112 BPM, upbeat electronic pop with warm synth plucks, soft side-chained pads, punchy but light drums, clean bass", 92 s asked, 87 s came out, so the mix slows it down (`TEMPO`).
- `sound/swish.mp3`, `click.mp3`, `pop.mp3`: [ElevenLabs Sound Effects](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert): "Very soft gentle airy swish, subtle and quiet, no impact, barely noticeable UI transition", "Soft short mouse click, subtle UI tap", "Gentle bubbly message pop notification, short and soft".
- `sound/cues.json`: when each sound plays. The script records them in `window.__sfx` (a quiet swish per wipe, a click per button tap, a pop per message). After changing the timeline, open `index.html` in Chrome, run `copy(JSON.stringify(window.__sfx))` in the console and paste it into `sound/cues.json`.

## Skills

HyperFrames publishes agent skills that describe the composition format, the GSAP rules and the CLI: [heygen-com/hyperframes/skills](https://github.com/heygen-com/hyperframes/tree/main/skills) (`hyperframes-cli`, `hyperframes-creative`). Install them into a project with `npx skills add heygen-com/hyperframes` before editing the video with an agent.
