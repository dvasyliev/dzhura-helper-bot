"""Run: cd src/features/karaoke/scripts && uv run python test_karaoke.py"""

from lyrics import match_score, parse_lrc, parse_plain, pick, split_title, text_language

assert [l["text"] for l in parse_lrc("[00:14.33] Забудь все\n[00:20.65] Сльози\n[02:40.54]\n")] == ["Забудь все", "Сльози"]
assert parse_lrc("[01:02.55] З ним")[0]["lrc_start"] == 62.55
assert parse_lrc("[01:24.97] \n[01:28.36] Your skin\n") == [{"text": "Your skin", "lrc_start": 88.36}], "an empty line must not swallow the next"
assert [l["text"] for l in parse_plain("[Приспів]\n1. Раз два\n\n[Chorus]\nТри чотири\n")] == ["Раз два", "Три чотири"]
assert parse_plain("Раз два")[0]["lrc_start"] is None

assert text_language("Її запах на речах") == "uk"
assert text_language("Ты мой ёжик") == "ru"
assert text_language("Hello darkness my old friend") == "en"

assert split_title("VOLODYMYR DANTES – Саша (Official Video)") == ("VOLODYMYR DANTES", "Саша")
assert split_title("Artist - Song | Премьера клипа 2021") == ("Artist", "Song")
assert split_title("Просто назва") is None

uk = {"syncedLyrics": "[00:01.00] Її запах", "plainLyrics": "Її запах", "duration": 161.0}
ru = {"syncedLyrics": "[00:01.00] Её запах ты", "plainLyrics": "Её запах ты ёж", "duration": 161.0}
assert pick([ru, uk], "uk", 162.0) is uk
assert pick([uk], "uk", 175.0) is None, "duration off by more than 10 s"

assert match_score("забудь все що було саша", "забудь все що було саша") == 1.0
assert match_score("забудь все що було саша", "hello world") == 0.0

from subtitles import build_ass, ts  # noqa: E402

w = lambda t, s, e: {"text": t, "start": s, "end": e}  # noqa: E731
song = [
    {"text": "Раз два", "words": [w("Раз", 14.5, 15.0), w("два", 15.2, 15.9)]},
    {"text": "Три", "words": [w("Три", 16.5, 17.0)]},
    {"text": "Після паузи", "words": [w("Після", 30.0, 30.5), w("паузи", 30.6, 31.0)]},
]
ass = build_ass(song, 1280, 720, "Artist — Song")
assert ts(62.555) == "0:01:02.56" and ts(-1) == "0:00:00.00"
assert sum(",Countdown," in l and "\\clip(" in l for l in ass.splitlines()) == 2, "two countdown bars: before the first line and after the 13 s pause"
assert "Artist — Song" in ass, "title card: the first countdown starts at 6.5 s"
assert "\\kf50}Раз" in ass and "\\k20}" in ass, "word fill and the gap between words"
assert "\\move(" in ass, "marker before «Раз два»"

early = build_ass([{"text": "Одразу", "words": [w("Одразу", 0.8, 1.5)]}], 1280, 720, "Назва")
events = early.split("[Events]")[1]
assert "Dialogue: 1,0:00:00.00" in events, "countdown clamped at 0"
assert "Назва" not in events, "no title card when singing starts at once"

wide = build_ass([{"text": "дуже " * 30, "words": [w("дуже " * 30, 10, 20)]}], 1280, 720, "T")
assert "\\fs" in wide.split("[Events]")[1], "a line wider than the frame is shrunk"

from fetch import find_song, song_name  # noqa: E402

assert song_name({"artist": "Coldplay", "track": "Yellow", "title": "Coldplay - Yellow (Official Video)"}) == "Coldplay - Yellow"
assert song_name({"artist": None, "track": None, "title": "AC/DC: Live?"}) == "AC_DC_ Live_", "no artist: the video title, file-safe"

import json, os, tempfile  # noqa: E401, E402

with tempfile.TemporaryDirectory() as data:
    os.makedirs(f"{data}/Coldplay - Yellow")
    with open(f"{data}/Coldplay - Yellow/meta.json", "w") as f:
        json.dump({"id": "yKNxeF4KMsY"}, f)
    assert find_song(data, "yKNxeF4KMsY") == f"{data}/Coldplay - Yellow", "a fetched clip is found by its YouTube id"
    assert find_song(data, "other") is None

import subprocess  # noqa: E402

from render import render  # noqa: E402

with tempfile.TemporaryDirectory() as tmp:
    song = os.path.join(tmp, "Guns N' Roses - Sweet Child O' Mine")
    os.makedirs(song)
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=320x180:d=1", "-f", "lavfi", "-i", "anullsrc=d=1",
                    "-shortest", "-c:v", "libx264", "-c:a", "aac", os.path.join(song, "clip.mp4")], check=True)
    with open(os.path.join(song, "karaoke.ass"), "w") as f:
        f.write(build_ass([{"text": "Раз", "words": [w("Раз", 0.2, 0.8)]}], 320, 180, "T"))
    out, full = render(song, os.path.join(song, "karaoke.ass"), "clip", os.path.join(song, "out.mp4"), 1)
    assert os.path.getsize(out) > 0, "an apostrophe in the song's folder must not break ffmpeg"
    assert out == full, "a video within Telegram's limit is also the full-quality one"
    import render as render_module
    limit, render_module.LIMIT = render_module.LIMIT, 1
    try:
        out, full = render(song, os.path.join(song, "karaoke.ass"), "clip", os.path.join(song, "big.mp4"), 1e-6)  # a tiny duration keeps the refit bitrate positive
    finally:
        render_module.LIMIT = limit
    assert out != full and os.path.exists(out) and os.path.exists(full), "an oversized video keeps its full-quality copy for YouTube"
    assert full.endswith("big (HQ).mp4"), full

intro = build_ass([{"text": "Раз", "words": [w("Раз", 6.0, 6.5)]}], 1280, 720, "Artist — Song")
assert "Artist — Song" in intro.split("[Events]")[1], "a 6 s intro still has room for the title card"

# Review fixes
from lyrics import own_lyrics, search  # noqa: E402
import lyrics  # noqa: E402

assert parse_lrc("[00:10.00][01:20.00] Знову\n[00:15.00] Раз\n") == [
    {"text": "Знову", "lrc_start": 10.0}, {"text": "Раз", "lrc_start": 15.0}, {"text": "Знову", "lrc_start": 80.0}
], "a line with several stamps repeats at each, in time order"
assert [l["text"] for l in parse_plain("Приспів:\n(Приспів)\nКуплет 2:\nChorus\n[Verse 1]\nПриспів мого серця\n")] == ["Приспів мого серця"], "section labels are not sung"

with tempfile.TemporaryDirectory() as song:
    assert own_lyrics(song, None, False, ["Чув"]) is None
    assert own_lyrics(song, "Раз\nДва", False, ["Чув"]) == "Раз\nДва"
    assert own_lyrics(song, None, False, ["Чув"]) == "Раз\nДва", "the owner's lyrics are reused for the other audio"
    assert own_lyrics(song, None, True, ["Чув", "це"]) == "Чув\nце"

lyrics.LRCLIB = "http://127.0.0.1:9/api/search"
assert search("Artist", "Song") == [], "LRCLIB unreachable counts as no lyrics"

assert song_name({"artist": ".38 Special", "track": "Hold On", "title": ""}) == "38 Special - Hold On", "no hidden folders"

tall = build_ass([{"text": "Раз", "words": [w("Раз", 10, 11)]}], 404, 720, "T")
assert "Style: Lyric,Arial,36," in tall, "a vertical clip is sized by its width"
assert "Style: Lyric,Arial,64," in ass, "landscape 720p keeps 64 px"

from fetch import video_name  # noqa: E402

shugar = {"artist": "Шугар", "track": "Німесил", "title": ""}
assert video_name(shugar, "uk", vocals=False) == "Шугар - Німесил (Караоке)"
assert video_name(shugar, "uk", vocals=True) == "Шугар - Німесил (Вокал)", "named like the buttons"
assert video_name(shugar, "ru", vocals=True) == "Шугар - Німесил (Вокал)"
assert video_name({"artist": "Coldplay", "track": "Yellow", "title": ""}, "en", vocals=False) == "Coldplay - Yellow (Karaoke)"
assert video_name({"artist": "Coldplay", "track": "Yellow", "title": ""}, "en", vocals=True) == "Coldplay - Yellow (Vocals)"

from fetch import outputs  # noqa: E402

assert outputs(shugar, "uk", ["music", "vocals"]) == [("Шугар - Німесил (Караоке)", False), ("Шугар - Німесил (Вокал)", True)], "two versions, in the order asked"
assert outputs(shugar, "uk", ["vocals"]) == [("Шугар - Німесил (Вокал)", True)]

from countin import count_in, delay  # noqa: E402

counted = build_ass([{"text": "Одразу", "words": [w("Одразу", 3.0, 3.5)]}], 1280, 720, "Назва", count_in=[0.1, 0.6, 1.1, 1.6])
digits = [l for l in counted.splitlines() if ",Digit," in l]
assert [l[-1] for l in digits] == ["4", "3", "2", "1"], "a count-in shows 4-3-2-1"
assert digits[0].startswith("Dialogue: 3,0:00:00.10,0:00:00.60,"), "each digit on its beat, one beat long"
assert "Dialogue: 1,0:00:00.00" in counted, "the bar fills over the whole pause"

assert delay([{"text": "Раз", "words": [w("Раз", 0.5, 1.0)]}], 2.0) == [{"text": "Раз", "words": [w("Раз", 2.5, 3.0)]}]

with tempfile.TemporaryDirectory() as tmp:
    clicks = os.path.join(tmp, "clicks.wav")  # a click every 0.5 s (120 BPM), the first at 0.2 s
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=f=1000:d=0.03,apad=whole_dur=0.5", "-af", "adelay=200,aloop=loop=40:size=22050",
                    "-ar", "44100", "-t", "20", clicks], check=True)
    pause, beats = count_in(clicks, 1.0)
    assert abs(pause - 2.0) < 0.1, pause
    assert len(beats) == 4 and abs(beats[1] - beats[0] - 0.5) < 0.05, beats
    assert abs(beats[-1] - 2.7) < 0.1, "«1» on the last beat before the first word (1.0 + 2.0 s pause), on the clicks' grid"

with tempfile.TemporaryDirectory() as tmp:
    song = os.path.join(tmp, "s")
    os.makedirs(song)
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=320x180:d=1", "-f", "lavfi", "-i", "anullsrc=d=1",
                    "-shortest", "-c:v", "libx264", "-c:a", "aac", os.path.join(song, "clip.mp4")], check=True)
    with open(os.path.join(song, "karaoke.ass"), "w") as f:
        f.write(build_ass([{"text": "Раз", "words": [w("Раз", 0.7, 1.2)]}], 320, 180, "T"))
    out, _ = render(song, os.path.join(song, "karaoke.ass"), "clip", os.path.join(song, "out.mp4"), 1.5, pause=0.5)
    length = lambda kind: float(subprocess.run(["ffprobe", "-v", "error", "-select_streams", kind, "-show_entries", "stream=duration", "-of", "csv=p=0", out],  # noqa: E731
                                               capture_output=True, text=True, check=True).stdout)
    assert abs(length("v") - 1.5) < 0.1 and abs(length("a") - 1.5) < 0.1, "the pause lengthens both picture and sound"
