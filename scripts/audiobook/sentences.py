"""Cutting chapter text into pieces a TTS model can take."""

import re

MAX_SENTENCE_CHARS = 300


def split_sentences(text: str) -> list[str]:
    """Sentences; a sentence longer than MAX_SENTENCE_CHARS is cut after commas (or spaces)."""
    pieces = []
    for sentence in re.split(r"(?<=[.!?…;])\s+", re.sub(r"\s+", " ", text).strip()):
        while len(sentence) > MAX_SENTENCE_CHARS:
            cut = sentence.rfind(", ", 0, MAX_SENTENCE_CHARS)
            if cut <= 0:
                cut = sentence.rfind(" ", 0, MAX_SENTENCE_CHARS)
            if cut <= 0:
                break
            pieces.append(sentence[: cut + 1])
            sentence = sentence[cut + 2 :]
        if re.search(r"\w", sentence):
            pieces.append(sentence)
    return pieces


def pack(pieces: list[str], max_chars: int) -> list[str]:
    """Joins consecutive pieces with spaces into chunks of at most max_chars."""
    chunks: list[str] = []
    for piece in pieces:
        if chunks and len(chunks[-1]) + 1 + len(piece) <= max_chars:
            chunks[-1] += " " + piece
        else:
            chunks.append(piece)
    return chunks
