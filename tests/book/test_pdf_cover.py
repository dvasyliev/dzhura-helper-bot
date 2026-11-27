from pathlib import Path

from PIL import Image

from dzhura_helper_bot.book.pdf_cover import looks_like_cover, write_cover


def pdf_with(tmp_path: Path, *sizes: tuple[int, int]) -> Path:
    pages = [Image.new("RGB", size, "blue") for size in sizes]
    path = tmp_path / "book.pdf"
    pages[0].save(path, "PDF", save_all=True, append_images=pages[1:])
    return path


def test_a_cover_is_upright_and_not_tiny() -> None:
    assert looks_like_cover(318, 450)
    assert not looks_like_cover(1190, 160)
    assert not looks_like_cover(28, 100)


def test_writes_the_first_upright_picture_as_jpeg(tmp_path: Path) -> None:
    pdf = pdf_with(tmp_path, (600, 120), (300, 450))
    out = tmp_path / "cover.jpg"
    assert write_cover(pdf, out)
    with Image.open(out) as cover:
        assert (cover.format, cover.size) == ("JPEG", (300, 450))


def test_writes_nothing_without_a_cover(tmp_path: Path) -> None:
    pdf = pdf_with(tmp_path, (600, 120))
    out = tmp_path / "cover.jpg"
    assert not write_cover(pdf, out)
    assert not out.exists()
