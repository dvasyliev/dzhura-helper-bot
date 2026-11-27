from dzhura_helper_bot.book.pdf_book import (
    Bookmark,
    Chapter,
    Item,
    book_title,
    chapters_from_headings,
    is_scan,
    split_book,
    to_markdown,
)

LONG = "word " * 60  # 300 chars, above the 200-char skip


def test_bookmarks_leaves_only_and_front_matter_dropped() -> None:
    marks = [
        Bookmark(1, "Introduction", 3),
        Bookmark(1, "I: Part", 5),
        Bookmark(2, "1. One", 6),
        Bookmark(2, "2. Two", 8),
        Bookmark(1, "Copyright", 10),
    ]
    items = [
        Item(1, "Praise " + LONG, False),
        Item(3, LONG, False),
        Item(5, "PART I", True),
        Item(6, "ONE", True),
        Item(6, LONG, False),
        Item(8, LONG, False),
        Item(10, "© 2007", False),
    ]
    chapters = split_book(marks, items)
    assert [c.title for c in chapters] == ["Introduction", "1. One", "2. Two"], "part and short copyright skipped"
    assert all("Praise" not in p for c in chapters for p in c.paragraphs)
    assert "PART I" not in chapters[0].paragraphs, "a part page ends the chapter before it and is not read"


def test_nested_bookmarks_keep_their_levels() -> None:
    marks = [Bookmark(1, "3. Three", 1), Bookmark(2, "3.1 First", 2), Bookmark(2, "3.2 Second", 3), Bookmark(1, "4", 4)]
    items = [
        Item(1, "THREE", True),
        Item(1, "opening " + LONG, False),
        Item(2, LONG, False),
        Item(3, LONG, False),
        Item(4, LONG, False),
    ]
    chapters = split_book(marks, items)
    assert [(c.title, c.level) for c in chapters] == [("3. Three", 1), ("3.1 First", 2), ("3.2 Second", 2), ("4", 1)]
    assert chapters[0].paragraphs == ["THREE", "opening " + LONG]


def test_short_part_page_moves_its_children_up_a_level() -> None:
    marks = [Bookmark(1, "Intro", 1), Bookmark(1, "Part I", 2), Bookmark(2, "1. One", 3), Bookmark(2, "2. Two", 4)]
    items = [Item(1, LONG, False), Item(2, "PART I", True), Item(3, LONG, False), Item(4, LONG, False)]
    chapters = split_book(marks, items)
    assert [(c.title, c.level) for c in chapters] == [("Intro", 1), ("1. One", 1), ("2. Two", 1)]


def test_shared_page_splits_at_title() -> None:
    marks = [Bookmark(1, "1. One", 1), Bookmark(1, "2. Two", 2), Bookmark(1, "3. Three", 3)]
    items = [
        Item(1, LONG, False),
        Item(2, "end of one " + LONG, False),
        Item(2, "TWO", True),
        Item(2, LONG, False),
        Item(3, LONG, False),
    ]
    one, two, _ = split_book(marks, items)
    assert one.paragraphs[-1].startswith("end of one")
    assert two.paragraphs[0] == "TWO"


def test_poor_bookmarks_fall_back_to_headings() -> None:
    marks = [Bookmark(1, "Cover", 1), Bookmark(1, "Contents", 2)]
    items = [
        Item(3, "CHAPTER 1", True),
        Item(3, "The Start", True),
        Item(3, LONG, False),
        Item(4, "Chapter 2", True),
        Item(4, "Next", True),
        Item(4, LONG, False),
    ]
    assert [c.title for c in split_book(marks, items)] == ["CHAPTER 1. The Start", "Chapter 2. Next"]


def test_headings_short_sections_merge_and_no_headings_is_one_chapter() -> None:
    items = [Item(1, "Note", True), Item(1, "short", False), Item(1, "Real", True), Item(1, LONG, False)]
    chapters = chapters_from_headings(items)
    assert [c.title for c in chapters] == ["Real"]
    assert chapters[0].paragraphs[0] == "Note", "merged into the next, kept as text"
    assert len(chapters_from_headings([Item(1, LONG, False)])) == 1


def test_book_title() -> None:
    assert book_title("The Art of Learning", "x.pdf") == "The Art of Learning"
    assert book_title(None, "my book.pdf") == "my book"
    assert book_title("Microsoft Word - draft", "my book.pdf") == "my book"
    assert book_title("layout_v3.indd", "my book.pdf") == "my book"


def test_is_scan() -> None:
    assert is_scan(500, 10)
    assert not is_scan(200_000, 180)


def test_to_markdown_quotes_and_escapes() -> None:
    md = to_markdown('Part 1: "Go"', None, [Chapter("A: b", ["#1 rule", "text"])])
    assert md.startswith('---\ntitle: "Part 1: \\"Go\\""\n---\n')
    assert "\n# A: b\n\n\\#1 rule\n\ntext\n" in md


def test_to_markdown_writes_levels() -> None:
    md = to_markdown("T", None, [Chapter("A", ["x"]), Chapter("B", ["y"], 2)])
    assert "\n# A\n\nx\n\n## B\n\ny\n" in md
