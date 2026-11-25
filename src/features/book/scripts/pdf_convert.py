"""Turns a text PDF into book.md.

Reads a JSON job from stdin: {"pdf": path, "out": path to book.md, "file_name": the name the PDF was sent with}.
Prints one JSON line: {"chapters": n}, or {"error": "scan"} for a PDF without a text layer (nothing is written).
"""

import json
import sys
from pathlib import Path

import pypdfium2
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling_core.types.doc.items.text import TextItem
from docling_core.types.doc.labels import DocItemLabel

from pdf_book import Bookmark, Item, book_title, is_scan, split_book, to_markdown

HEADINGS = {DocItemLabel.SECTION_HEADER, DocItemLabel.TITLE}
# Notes, pictures and tables are not read aloud or translated for now.
SKIPPED = {DocItemLabel.FOOTNOTE, DocItemLabel.CAPTION, DocItemLabel.PICTURE, DocItemLabel.TABLE}


def main() -> None:
    job = json.load(sys.stdin)
    pdf = Path(job["pdf"])
    items = read_items(pdf)
    bookmarks, meta, pages = read_outline(pdf)
    if is_scan(sum(len(i.text) for i in items), pages):
        print(json.dumps({"error": "scan"}), flush=True)
        return
    chapters = split_book(bookmarks, items)
    title = book_title(meta.get("Title"), job["file_name"])
    author = (meta.get("Author") or "").strip() or None
    Path(job["out"]).write_text(to_markdown(title, author, chapters), encoding="utf-8")
    print(json.dumps({"chapters": len(chapters)}), flush=True)


def read_items(pdf: Path) -> list[Item]:
    """Text items of the body (no running headers or page numbers), each with its first page."""
    options = PdfPipelineOptions(do_ocr=False, do_table_structure=False)
    converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})
    document = converter.convert(pdf).document
    items: list[Item] = []
    for item, _level in document.iterate_items():
        if not isinstance(item, TextItem) or item.label in SKIPPED or not item.prov or not item.text.strip():
            continue
        items.append(Item(item.prov[0].page_no, item.text.strip(), item.label in HEADINGS))
    return items


def read_outline(pdf: Path) -> tuple[list[Bookmark], dict[str, str], int]:
    """Bookmarks with 1-based pages, the metadata and the page count."""
    document = pypdfium2.PdfDocument(pdf)
    try:
        bookmarks: list[Bookmark] = []
        for mark in document.get_toc():
            dest = mark.get_dest()
            index = dest.get_index() if dest else None
            if index is not None:
                bookmarks.append(Bookmark(mark.level, mark.get_title(), index + 1))
        return bookmarks, document.get_metadata_dict(), len(document)
    finally:
        document.close()


if __name__ == "__main__":
    main()
