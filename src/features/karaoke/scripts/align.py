"""Word timings for known lyrics on the vocal stem (ctc-forced-aligner, MMS model, romanized text)."""

import sys

import numpy as np

from lyrics import Line

ALIGNER_LANGUAGE = {"uk": "ukr", "ru": "rus", "en": "eng"}
MAX_DRIFT = 1.0  # a line further than this from the LRC timing (after the clip's offset) is re-aligned
LOST = (
    2.0  # a re-aligned line still this far off (a hum, «uh-huh»: no speech for the model) goes on the voice heard there
)
VOICE_GAP = 0.3  # a silence longer than this ends the line's voice
SAMPLE_RATE = 16000  # ctc-forced-aligner's load_audio


def voiced_span(samples: np.ndarray, sr: int, start: float, end: float) -> tuple[float, float] | None:
    """The first stretch of voice in [start, end] s, ended by a silence longer than VOICE_GAP; None for silence."""
    hop = sr // 20
    seg = samples[int(start * sr) : int(end * sr)]
    rms = np.sqrt([np.mean(seg[i : i + hop] ** 2) for i in range(0, len(seg) - hop + 1, hop)])
    if not len(rms) or rms.max() < 1e-3:
        return None
    loud = np.flatnonzero(rms > 0.2 * rms.max())
    first = last = loud[0]
    for i in loud[1:]:
        if (i - last - 1) * hop / sr > VOICE_GAP:
            break
        last = i
    return round(start + float(first) * hop / sr, 3), round(start + float(last + 1) * hop / sr, 3)


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
            if abs(a["words"][0]["start"] - l["lrc_start"] - offset) <= MAX_DRIFT:
                continue
            next_lrc = lines[i + 1]["lrc_start"] if i + 1 < len(lines) else l["lrc_start"] + 11
            first = max(0, int((l["lrc_start"] + offset - 1.0) / frame))
            last = min(int((next_lrc + offset + 0.5) / frame), emissions.shape[0])
            if last - first < 10:  # the line falls past the end of a shorter clip: keep the full pass's timing
                continue
            a["words"] = words_in(l["text"], first, last, "edges")
            print(f"re-aligned: {l['text']}", file=sys.stderr)
            if abs(a["words"][0]["start"] - l["lrc_start"] - offset) > LOST:
                samples = audio.float().cpu().numpy()
                span = voiced_span(samples, SAMPLE_RATE, l["lrc_start"] + offset - 0.5, next_lrc + offset)
                if span:
                    a["words"] = spread([w["text"] for w in a["words"]], *span)
                    print(f"placed on the voice: {l['text']}", file=sys.stderr)
    return aligned
