"""Youka-style karaoke subtitles (.ass) from word-aligned lyric lines.

Two lines on screen in alternating slots; words fill with \\kf as they are sung; a progress bar with 3-2-1
before the first line and after long pauses; a marker that slides to the first word of a phrase.
"""

from dataclasses import dataclass

from PIL import ImageFont

FONT_FILE = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
SUNG = "&H00E0901E&"  # #1E90E0 in ASS BGR
COUNTDOWN_GAP = 5.0  # a pause longer than this gets a countdown bar
COUNTDOWN_MAX = 8.0
DIGITS = 4  # the countdown digits 4-3-2-1, a second apart or squeezed into a shorter bar
MARKER_GAP = 1.0  # a pause at least this long gets a marker before the line
MARKER_LEAD = 1.5  # seconds the marker travels
MARKER_FROM, MARKER_TO = 140, 16  # px left of the line at 720p

_probe = ImageFont.truetype(FONT_FILE, 100)
_ascent, _descent = _probe.getmetrics()


def ts(t: float) -> str:
    cs = round(max(t, 0) * 100)
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def text_width(text: str, size: int) -> float:
    """Width in px of `text` rendered by libass at ASS font size `size` (libass size = ascent + descent)."""
    return ImageFont.truetype(FONT_FILE, round(size * 100 / (_ascent + _descent))).getlength(text)


def _blocks(lines: list[dict]) -> list[list[int]]:
    blocks, cur = [], [0]
    for i in range(1, len(lines)):
        if lines[i]["start"] - lines[i - 1]["end"] > COUNTDOWN_GAP:
            blocks.append(cur)
            cur = []
        cur.append(i)
    blocks.append(cur)
    return blocks


@dataclass
class _Layout:
    """Sizes and positions in px for one video size and title."""

    width: int
    s: float  # 1 at 720p; a vertical clip (Shorts) is sized by its width
    title: str
    font: int
    slot_y: list[int]
    bar_w: int
    bar_h: int
    bar_y: int
    digit_y: int  # between the bar and the lyrics


Event = tuple[int, float, float, str, str]  # layer, start, end, style, text


def _layout(width: int, height: int, title: str) -> _Layout:
    s = min(width, height) / 720
    return _Layout(
        width=width,
        s=s,
        title=title,
        font=round(64 * s),
        slot_y=[height - round(160 * s), height - round(80 * s)],
        bar_w=round(360 * s),
        bar_h=round(18 * s),
        bar_y=round(230 * s),
        digit_y=round(370 * s),
    )


def _countdown(
    lay: _Layout, first: dict, prev_end: float, count_in: list[float] | None
) -> tuple[list[Event], float, list[tuple[int, float]]]:
    """The title card, progress bar and digits before a block; also the bar's start and the digit ticks (number, time)."""
    cd = min(COUNTDOWN_MAX, max(first["start"] - prev_end - 1.0, 1.5))
    if prev_end == 0.0 and first["start"] >= 5.5:
        cd = min(cd, first["start"] - 2.5)  # leaves the first 2.5 s of the intro for the title card, 3‑2‑1 still fits
    cd_start, cd_end = max(0.0, first["start"] - cd), first["start"] - 0.15
    if prev_end == 0.0 and count_in:
        bar_start, beat = count_in[0], count_in[1] - count_in[0]
        ticks = [(len(count_in) - k, t) for k, t in enumerate(count_in)]
    else:
        bar_start, beat = cd_start, min(1.0, (cd_end - cd_start) / DIGITS)
        ticks = [(n, cd_end - n * beat) for n in range(DIGITS, 0, -1)]
    events: list[Event] = []
    if prev_end == 0.0 and cd_start > 2.0:
        events.append((2, 0.3, cd_start - 0.2, "Title", f"{{\\fad(400,400)}}{lay.title}"))

    x1, y1 = (lay.width - lay.bar_w) // 2, lay.bar_y - lay.bar_h // 2
    x2, y2 = x1 + lay.bar_w, y1 + lay.bar_h
    rect = f"m 0 0 l {lay.bar_w} 0 {lay.bar_w} {lay.bar_h} 0 {lay.bar_h}"
    fill_ms = round((cd_end - bar_start) * 1000)
    events.append((1, bar_start, cd_end, "Countdown", f"{{\\an7\\pos({x1},{y1})\\p1}}{rect}"))
    events.append(
        (
            2,
            bar_start,
            cd_end,
            "Countdown",
            f"{{\\an7\\pos({x1},{y1})\\1c{SUNG}\\clip({x1},{y1},{x1},{y2})\\t(0,{fill_ms},\\clip({x1},{y1},{x2},{y2}))\\p1}}{rect}",
        )
    )
    for n, t in ticks:
        events.append((3, t, t + beat, "Digit", f"{{\\an5\\pos({lay.width // 2},{lay.digit_y})}}{n}"))
    return events, bar_start, ticks


def _fit(lay: _Layout, text: str) -> tuple[int, float]:
    """(font size, width in px) of a line, shrunk to fit the screen."""
    size = lay.font
    w = text_width(text, size)
    if w > lay.width - 80:
        size = int(size * (lay.width - 80) / w)
        w = text_width(text, size)
    return size, w


def _lyric(lay: _Layout, ln: dict, slot: int, size: int, show: float) -> str:
    """The text of a lyric line: words fill with \\kf as they are sung, from the time the line appears."""
    fs = f"\\fs{size}" if size != lay.font else ""
    parts = [f"{{\\an2\\pos({lay.width // 2},{lay.slot_y[slot]}){fs}\\fad(150,150)}}"]
    cursor = round(show * 100)
    for j, word in enumerate(ln["words"]):
        start, end = round(word["start"] * 100), round(word["end"] * 100)
        if start > cursor:
            parts.append(f"{{\\k{start - cursor}}}")
            cursor = start
        dur = max(1, end - cursor)
        parts.append(f"{{\\kf{dur}}}{word['text']}" + (" " if j < len(ln["words"]) - 1 else ""))
        cursor += dur
    return "".join(parts)


def _marker(lay: _Layout, ln: dict, slot: int, fit: tuple[int, float], lead: float) -> Event:
    """The marker that slides in to the line's first word."""
    s = lay.s
    size, w = fit
    left = lay.width / 2 - w / 2
    y = lay.slot_y[slot] - size // 2
    mark = f"m 0 0 l {round(10 * s)} 0 {round(10 * s)} {round(size * 0.8)} 0 {round(size * 0.8)}"
    return (
        2,
        ln["start"] - lead,
        ln["start"] + 0.05,
        "Marker",
        f"{{\\an5\\move({left - MARKER_FROM * s:.0f},{y},{left - MARKER_TO * s:.0f},{y},0,{round(lead * 1000)})"
        f"\\fad(200,80)\\p1}}{mark}",
    )


def _block_lines(lay: _Layout, lines: list[dict], block: list[int], earliest: float) -> list[Event]:
    """The lyric line and marker events of a block; its first two lines show up no earlier than `earliest`."""
    events: list[Event] = []
    shows = [
        earliest if k < 2 else max(lines[block[k - 1]]["start"], lines[block[k - 2]]["end"] + 0.2)
        for k in range(len(block))
    ]
    for k, i in enumerate(block):
        ln = lines[i]
        show = shows[k]
        hide = max(lines[block[k + 1]]["start"], ln["end"] + 0.2) if k + 2 < len(block) else ln["end"] + 0.8
        size, w = _fit(lay, ln["text"])
        events.append((2, show, hide, "Lyric", _lyric(lay, ln, k % 2, size, show)))

        gap = ln["start"] - (lines[i - 1]["end"] if i > 0 else 0.0)
        lead = min(MARKER_LEAD, ln["start"] - show)
        if gap >= MARKER_GAP and lead >= 0.5:
            events.append(_marker(lay, ln, k % 2, (size, w), lead))
    return events


def build_ass(lines: list[dict], width: int, height: int, title: str, count_in: list[float] | None = None) -> str:
    """`count_in`: the beats of a pause added before the song; they get 4-3-2-1 instead of 3-2-1."""
    lay = _layout(width, height, title)
    s, font = lay.s, lay.font
    lines = [
        {**ln, "text": ln["text"].strip(), "start": ln["words"][0]["start"], "end": ln["words"][-1]["end"]}
        for ln in lines
    ]
    events: list[Event] = []
    prev_end = 0.0
    for block in _blocks(lines):
        first = lines[block[0]]
        countdown, bar_start, ticks = _countdown(lay, first, prev_end, count_in)
        events += countdown
        earliest = max(bar_start, min(ticks[-1][1], first["start"] - MARKER_LEAD))
        events += _block_lines(lay, lines, block, earliest)
        prev_end = lines[block[-1]]["end"]

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Lyric,Arial,{font},{SUNG},&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,40,40,40,1
Style: Title,Arial,{round(84 * s)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,3,5,40,40,40,1
Style: Countdown,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,7,0,0,0,1
Style: Digit,Arial,{round(150 * s)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,{round(6 * s)},0,5,0,0,0,1
Style: Marker,Arial,20,{SUNG},{SUNG},&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    body = "".join(
        f"Dialogue: {layer},{ts(a)},{ts(b)},{style},,0,0,0,,{text}\n"
        for layer, a, b, style, text in sorted(events, key=lambda e: e[1])
    )
    return header + body
