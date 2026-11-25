"""Splits a PDF's text into chapters and writes them as book.md; no PDF library here, only plain data."""

import json
import re
from pathlib import Path
from typing import NamedTuple

# A chapter with less text than this is a dedication, copyright page and so on (as MIN_CHAPTER_CHARS in epub.ts).
MIN_CHAPTER_CHARS = 200
# Fewer chapters than this from the bookmarks means they mark only the cover or the contents.
MIN_BOOKMARK_CHAPTERS = 3
# Less text than this per page on average means the PDF is a scan without a text layer.
MIN_CHARS_PER_PAGE = 100
UNTITLED = "Text"

CHAPTER_NUMBER = re.compile(r"^(chapter|розділ|глава)\s+(\d+|[ivxlc]+)\.?$", re.IGNORECASE)
TITLE_NUMBER = re.compile(r"^\s*(\d+|[ivxlc]+)\s*[.:]\s*", re.IGNORECASE)
JUNK_TITLE = re.compile(r"(\.(docx?|pdf|indd)\s*$)|(^microsoft word -)", re.IGNORECASE)


class Item(NamedTuple):
    """One docling text item; page is 1-based."""

    page: int
    text: str
    heading: bool


class Bookmark(NamedTuple):
    level: int
    title: str
    page: int


class Chapter(NamedTuple):
    title: str
    paragraphs: list[str]


def split_book(bookmarks: list[Bookmark], items: list[Item]) -> list[Chapter]:
    chapters = chapters_from_bookmarks(bookmarks, items)
    return chapters if len(chapters) >= MIN_BOOKMARK_CHAPTERS else chapters_from_headings(items)


def chapters_from_bookmarks(bookmarks: list[Bookmark], items: list[Item]) -> list[Chapter]:
    """Leaf bookmarks are chapters; any bookmark ends the chapter before it.

    The text of a bookmark with children (a part's title page, a chapter's opening before its first section) opens
    its first child. Items before the first bookmark (praise, ads, contents) are dropped.
    """
    starts = [chapter_start(mark, items) for mark in bookmarks]
    chapters: list[Chapter] = []
    carry: list[str] = []
    for i, mark in enumerate(bookmarks):
        end = starts[i + 1] if i + 1 < len(starts) else len(items)
        paragraphs = carry + [item.text for item in items[starts[i] : max(end, starts[i])]]
        if i + 1 < len(bookmarks) and bookmarks[i + 1].level > mark.level:
            carry = paragraphs
            continue
        carry = []
        if text_length(paragraphs) >= MIN_CHAPTER_CHARS:
            chapters.append(Chapter(mark.title, paragraphs))
    return chapters


def chapter_start(leaf: Bookmark, items: list[Item]) -> int:
    """Index of the chapter's first item: its title heading (with headings right before it) or its page start."""
    first = next((i for i, item in enumerate(items) if item.page >= leaf.page), len(items))
    title = letters(TITLE_NUMBER.sub("", leaf.title))
    match = next(
        (
            i
            for i in range(first, len(items))
            if items[i].page == leaf.page and items[i].heading and letters(items[i].text) == title
        ),
        None,
    )
    if match is None:
        return first
    while match > first and items[match - 1].heading:
        match -= 1
    return match


def chapters_from_headings(items: list[Item]) -> list[Chapter]:
    """Every heading starts a section; «CHAPTER 5» joins the heading after it; short sections merge into the next."""
    sections: list[Chapter] = []
    for item in items:
        if not item.heading:
            if not sections:
                sections.append(Chapter(UNTITLED, []))
            sections[-1].paragraphs.append(item.text)
        elif sections and not sections[-1].paragraphs and CHAPTER_NUMBER.match(sections[-1].title):
            sections[-1] = Chapter(f"{sections[-1].title}. {item.text}", [])
        else:
            sections.append(Chapter(item.text, []))
    return merge_short(sections)


def merge_short(sections: list[Chapter]) -> list[Chapter]:
    chapters: list[Chapter] = []
    carry: list[str] = []
    for section in sections:
        if text_length(section.paragraphs) < MIN_CHAPTER_CHARS:
            carry = [*carry, section.title, *section.paragraphs]
            continue
        chapters.append(Chapter(section.title, carry + section.paragraphs))
        carry = []
    if carry and chapters:
        chapters[-1].paragraphs.extend(carry)
    elif carry:
        chapters.append(Chapter(UNTITLED, carry))
    return chapters


def book_title(meta_title: str | None, file_name: str) -> str:
    title = (meta_title or "").strip()
    return title if title and not JUNK_TITLE.search(title) else Path(file_name).stem


def is_scan(text_chars: int, pages: int) -> bool:
    return text_chars / max(pages, 1) < MIN_CHARS_PER_PAGE


def to_markdown(title: str, author: str | None, chapters: list[Chapter]) -> str:
    """Pandoc-style YAML front matter, a `#` heading per chapter, one line per paragraph."""
    lines = ["---", f"title: {json.dumps(title, ensure_ascii=False)}"]
    if author:
        lines.append(f"author: {json.dumps(author, ensure_ascii=False)}")
    lines += ["---", ""]
    for chapter in chapters:
        lines += [f"# {one_line(chapter.title)}", ""]
        for paragraph in chapter.paragraphs:
            text = one_line(paragraph)
            lines += ["\\" + text if text.startswith("#") else text, ""]
    return "\n".join(lines)


def one_line(text: str) -> str:
    return " ".join(text.split())


def letters(text: str) -> str:
    return "".join(c for c in text.lower() if c.isalnum())


def text_length(paragraphs: list[str]) -> int:
    return sum(len(p) for p in paragraphs)
