"""Word timings for known lyrics on the vocal stem (ctc-forced-aligner, MMS model, romanized text)."""

import sys

import numpy as np

from lyrics import Line

ALIGNER_LANGUAGE = {"uk": "ukr", "ru": "rus", "en": "eng"}
MAX_DRIFT = 1.0  # a line further than this from the LRC timing (after the clip's offset) is re-aligned
LOST = (
    2.0  # a re-aligned line still this far off (a hum, «uh-huh»: no speech for the model) goes on the voice heard there
)
CRAMMED = 0.5  # a line sung in less than this share of its LRC time is squeezed into the wrong place: re-aligned
VOICE_GAP = 0.3  # a silence longer than this ends the line's voice
BREAK = 2.0  # a silence longer than this is a break between verses: a re-aligned line does not reach past it
SAMPLE_RATE = 16000  # ctc-forced-aligner's load_audio


def voiced_span(
    samples: np.ndarray, sr: int, start: float, end: float, gap: float = VOICE_GAP
) -> tuple[float, float] | None:
    """The first stretch of voice in [start, end] s, ended by a silence longer than `gap`; None for silence."""
    hop = sr // 20
    seg = samples[int(start * sr) : int(end * sr)]
    rms = np.sqrt([np.mean(seg[i : i + hop] ** 2) for i in range(0, len(seg) - hop + 1, hop)])
    if not len(rms) or rms.max() < 1e-3:
        return None
    loud = np.flatnonzero(rms > 0.2 * rms.max())
    first = last = loud[0]
    for i in loud[1:]:
        if (i - last - 1) * hop / sr > gap:
            break
        last = i
    return round(start + float(first) * hop / sr, 3), round(start + float(last + 1) * hop / sr, 3)


def silent_runs(lines: list[dict], samples: np.ndarray, sr: int) -> list[tuple[int, int]]:
    """(first, last) index of each run of lines that start where no one sings: placed wrong, often past the song's end."""
    hop = sr // 20
    frames = samples[: len(samples) // hop * hop].reshape(-1, hop)
    rms = np.sqrt((frames**2).mean(axis=1))
    voiced = rms > 0.05 * float(np.percentile(rms, 95))
    lost = [
        not voiced[max(0, int(l["words"][0]["start"] * 20) - 2) : int(l["words"][0]["start"] * 20) + 8].any()
        for l in lines
    ]
    runs, i = [], 0
    while i < len(lines):
        if lost[i]:
            j = i
            while j + 1 < len(lines) and lost[j + 1]:
                j += 1
            runs.append((i, j))
            i = j
        i += 1
    return runs


def voiced_regions(samples: np.ndarray, sr: int, start: float, end: float) -> list[tuple[float, float]]:
    """Stretches of voice in [start, end] s, split by silences of half a second; blips shorter than 0.4 s left out."""
    hop = sr // 20
    frames = samples[: len(samples) // hop * hop].reshape(-1, hop)
    rms = np.sqrt((frames**2).mean(axis=1))
    voiced = rms > 0.05 * float(np.percentile(rms, 95))
    regions: list[list[int]] = []
    for f in range(int(start * 20), min(int(end * 20), len(voiced))):
        if not voiced[f]:
            continue
        if regions and f - regions[-1][1] <= 10:
            regions[-1][1] = f + 1
        else:
            regions.append([f, f + 1])
    return [(a / 20, b / 20) for a, b in regions if b - a >= 8]


def trim_to_voice(words: list[dict], samples: np.ndarray, sr: int) -> list[dict]:
    """Ends each word when the voice stops: the aligner stretches the last word before a break over the silence."""
    trimmed = []
    for w in words:
        span = voiced_span(samples, sr, w["start"], w["end"])
        end = min(w["end"], span[1]) if span else w["end"]
        trimmed.append({**w, "end": max(end, round(w["start"] + 0.1, 3))})
    return trimmed


def untangle(lines: list[dict]) -> list[dict]:
    """Ends a line's last word where the next line starts, so two lines never sing at once."""
    out = [dict(l) for l in lines]
    for a, b in zip(out, out[1:]):
        last, nxt = a["words"][-1], b["words"][0]["start"]
        if last["end"] > nxt:
            a["words"] = [*a["words"][:-1], {**last, "end": round(max(nxt - 0.02, last["start"] + 0.1), 3)}]
    return out


def hold_lone_words(lines: list[dict], samples: np.ndarray, sr: int) -> list[dict]:
    """A one-word line («Боже») lasts as long as it is sung, up to the next line."""
    out = [dict(l) for l in lines]
    for k, line in enumerate(out):
        if len(line["words"]) != 1:
            continue
        w = line["words"][0]
        nxt = out[k + 1]["words"][0]["start"] if k + 1 < len(out) else w["end"] + BREAK
        regions = voiced_regions(samples, sr, w["start"] - 0.2, nxt)
        if regions and regions[0][0] <= w["start"] + 0.2 and regions[0][1] > w["end"]:
            line["words"] = [{**w, "end": round(min(regions[0][1], nxt - 0.02), 3)}]
    return out


def spread(texts: list[str], start: float, end: float) -> list[dict]:
    """Words laid over [start, end] by their length."""
    total, words, t = sum(len(x) for x in texts), [], start
    for x in texts:
        step = (end - start) * len(x) / total
        words.append({"text": x, "start": round(t, 3), "end": round(t + step, 3), "score": None})
        t += step
    return words


def align(vocals_wav: str, lines: list[Line], language: str) -> list[dict]:
    """[{"text", "words": [{"text", "start", "end", "score"}]}] per line, in seconds of the clip."""
    import torch
    from ctc_forced_aligner import (
        generate_emissions,
        get_alignments,
        get_spans,
        load_alignment_model,
        load_audio,
        postprocess_results,
        preprocess_text,
    )

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model, tokenizer = load_alignment_model(device, dtype=torch.float32)
    audio = load_audio(vocals_wav, model.dtype, model.device)
    emissions, stride = generate_emissions(model, audio, batch_size=4)
    samples = audio.float().cpu().numpy()
    frame = stride / 1000  # seconds per emission frame
    iso = ALIGNER_LANGUAGE[language]

    def words_in(text: str, first: int, last: int, star: str) -> list[dict]:
        tokens, chunks = preprocess_text(text, romanize=True, language=iso, split_size="word", star_frequency=star)
        segments, scores, blank = get_alignments(emissions[first:last], tokens, tokenizer)
        results = postprocess_results(chunks, get_spans(tokens, segments, blank), stride, scores)
        shift = first * frame
        return [
            {
                "text": r["text"],
                "start": round(r["start"] + shift, 3),
                "end": round(r["end"] + shift, 3),
                "score": round(r["score"], 3),
            }
            for r in results
        ]

    words = words_in(" ".join(l["text"] for l in lines), 0, emissions.shape[0], "segment")
    aligned, k = [], 0
    for line in lines:
        n = len(line["text"].split())
        aligned.append({"text": line["text"], "words": words[k : k + n]})
        k += n

    if all(l["lrc_start"] is not None for l in lines):
        drifts = sorted(a["words"][0]["start"] - l["lrc_start"] for a, l in zip(aligned, lines))
        offset = drifts[len(drifts) // 2]  # the clip's intro may be longer or shorter than the album's
        for i, (a, l) in enumerate(zip(aligned, lines)):
            assert l["lrc_start"] is not None  # checked above for every line
            next_lrc = (lines[i + 1]["lrc_start"] if i + 1 < len(lines) else None) or l["lrc_start"] + 11
            drifted = abs(a["words"][0]["start"] - l["lrc_start"] - offset) > MAX_DRIFT
            crammed = a["words"][-1]["end"] - a["words"][0]["start"] < CRAMMED * (next_lrc - l["lrc_start"])
            if not (drifted or crammed):
                continue
            # not before the previous line's last word has had a moment: windows of neighbours overlap
            after_previous = aligned[i - 1]["words"][-1]["start"] + 0.3 if i else 0.0
            first = max(0, int(max(l["lrc_start"] + offset - 1.0, after_previous) / frame))
            window_end = next_lrc + offset + 0.5
            sung = voiced_span(samples, SAMPLE_RATE, first * frame, window_end, BREAK)
            last = min(int(((sung[1] + 0.3) if sung else window_end) / frame), emissions.shape[0])
            if last - first < 10:  # the line falls past the end of a shorter clip: keep the full pass's timing
                continue
            a["words"] = words_in(l["text"], first, last, "edges")
            print(f"re-aligned: {l['text']}", file=sys.stderr)
            if abs(a["words"][0]["start"] - l["lrc_start"] - offset) > LOST:
                span = voiced_span(samples, SAMPLE_RATE, l["lrc_start"] + offset - 0.5, next_lrc + offset)
                if span:
                    a["words"] = spread([w["text"] for w in a["words"]], *span)
                    print(f"placed on the voice: {l['text']}", file=sys.stderr)
    for i, j in silent_runs(aligned, samples, SAMPLE_RATE):
        while i > 0 and aligned[i - 1]["text"] == aligned[i]["text"]:  # identical repeats get swapped: take them all
            i -= 1
        after = aligned[i - 1]["words"][-1]["end"] if i else 0.0
        before = aligned[j + 1]["words"][0]["start"] if j + 1 < len(aligned) else emissions.shape[0] * frame
        texts = [aligned[k]["text"] for k in range(i, j + 1)]
        regions = voiced_regions(samples, SAMPLE_RATE, after, before)
        if len(regions) == len(texts):  # one stretch of voice per line: each line goes on its own
            for k, text, region in zip(range(i, j + 1), texts, regions):
                aligned[k]["words"] = spread(text.split(), *region)
        else:
            words = words_in(" ".join(texts), int(after / frame), int(before / frame), "edges")
            for k, text in zip(range(i, j + 1), texts):
                n = len(text.split())
                aligned[k]["words"], words = words[:n], words[n:]
        print(f"re-aligned off the silence: {' / '.join(texts)}", file=sys.stderr)
    trimmed = [{**a, "words": trim_to_voice(a["words"], samples, SAMPLE_RATE)} for a in aligned]
    return untangle(hold_lone_words(trimmed, samples, SAMPLE_RATE))
