"""Takes a PDF's cover: the first picture on its first pages that looks like one.

Reads a JSON job from stdin: {"pdf": path, "out": path of the JPEG to write}.
Prints one JSON line: {"cover": true} when it wrote one, else {"cover": false}.
"""

import json
import sys
from pathlib import Path

import pypdfium2
import pypdfium2.raw as pdfium_c
from pydantic import BaseModel

# The cover is on one of the first pages; a summary's page may show it next to banners.
PAGES = 3
# Narrower pictures are icons, rules or banners.
MIN_WIDTH = 200


def looks_like_cover(width: int, height: int) -> bool:
    """A cover stands upright and is not tiny."""
    return width >= MIN_WIDTH and height >= width


def write_cover(pdf: Path, out: Path) -> bool:
    document = pypdfium2.PdfDocument(pdf)
    try:
        for index in range(min(PAGES, len(document))):
            for image in document[index].get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_IMAGE], max_depth=3):
                if not isinstance(image, pypdfium2.PdfImage):
                    continue
                if looks_like_cover(*image.get_px_size()):
                    image.get_bitmap().to_pil().convert("RGB").save(out, "JPEG", quality=90)
                    return True
        return False
    finally:
        document.close()


class Job(BaseModel):
    pdf: str
    out: str


def main() -> None:
    job = Job.model_validate_json(sys.stdin.read())
    print(json.dumps({"cover": write_cover(Path(job.pdf), Path(job.out))}))


if __name__ == "__main__":
    main()
