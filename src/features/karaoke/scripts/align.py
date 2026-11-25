"""Word timings for known lyrics on the vocal stem (ctc-forced-aligner, MMS model, romanized text)."""

import sys

from lyrics import Line

ALIGNER_LANGUAGE = {"uk": "ukr", "ru": "rus", "en": "eng"}
MAX_DRIFT = 1.0  # a line further than this from the LRC timing (after the clip's offset) is re-aligned


def align(vocals_wav: str, lines: list[Line], language: str) -> list[dict]:
    """[{"text", "words": [{"text", "start", "end", "score"}]}] per line, in seconds of the clip."""
    import torch
    from ctc_forced_aligner import generate_emissions, get_alignments, get_spans, load_alignment_model, load_audio, postprocess_results, preprocess_text

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model, tokenizer = load_alignment_model(device, dtype=torch.float32)
    emissions, stride = generate_emissions(model, load_audio(vocals_wav, model.dtype, model.device), batch_size=4)
    frame = stride / 1000  # seconds per emission frame
    iso = ALIGNER_LANGUAGE[language]

    def words_in(text: str, first: int, last: int, star: str) -> list[dict]:
        tokens, chunks = preprocess_text(text, romanize=True, language=iso, split_size="word", star_frequency=star)
        segments, scores, blank = get_alignments(emissions[first:last], tokens, tokenizer)
        results = postprocess_results(chunks, get_spans(tokens, segments, blank), stride, scores)
        shift = first * frame
        return [{"text": r["text"], "start": round(r["start"] + shift, 3), "end": round(r["end"] + shift, 3), "score": round(r["score"], 3)} for r in results]

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
            if abs(a["words"][0]["start"] - l["lrc_start"] - offset) <= MAX_DRIFT:
                continue
            next_lrc = lines[i + 1]["lrc_start"] if i + 1 < len(lines) else l["lrc_start"] + 11
            first = max(0, int((l["lrc_start"] + offset - 1.0) / frame))
            last = min(int((next_lrc + offset + 0.5) / frame), emissions.shape[0])
            if last - first < 10:  # the line falls past the end of a shorter clip: keep the full pass's timing
                continue
            a["words"] = words_in(l["text"], first, last, "edges")
            print(f"re-aligned: {l['text']}", file=sys.stderr)
    return aligned
