import argparse
import json
import os
import re
import time
from pathlib import Path

import fitz
import requests

BASE_URL = "https://download.hebrewbooks.org/downloadhandler.ashx"


def normalize_title(title: str) -> str:
    title = title.strip()
    title = re.sub(r"\s+", " ", title)
    return title


def download_pdf(book_id: int, output_dir: Path, session: requests.Session, headers: dict, timeout: int = 60) -> Path | None:
    output_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = output_dir / f"hebrewbooks-{book_id}.pdf"
    url = f"{BASE_URL}?req={book_id}"
    with session.get(url, headers=headers, stream=True, timeout=timeout) as resp:
        if resp.status_code != 200:
            print(f"[skip] book {book_id} returned HTTP {resp.status_code}")
            return None
        content_type = resp.headers.get("Content-Type", "")
        if "pdf" not in content_type.lower():
            print(f"[skip] book {book_id} content-type not PDF: {content_type}")
            return None
        with open(pdf_path, "wb") as fh:
            for chunk in resp.iter_content(chunk_size=1048576):
                if chunk:
                    fh.write(chunk)
    return pdf_path


def extract_book_text(pdf_path: Path) -> tuple[str, list[dict]]:
    doc = fitz.open(pdf_path)
    title = normalize_title(doc.metadata.get("title", "").strip() or pdf_path.stem)
    pages = []
    for page_number in range(doc.page_count):
        page = doc.load_page(page_number)
        text = page.get_text("text")
        if not text or not text.strip():
            continue
        pages.append({
            "page": page_number + 1,
            "text": text.replace("\r\n", "\n"),
        })
    return title, pages


def build_record(book_id: int, title: str, page_info: dict) -> dict:
    return {
        "book_id": book_id,
        "book_title": title,
        "page": page_info["page"],
        "text": page_info["text"],
    }


def write_jsonl_chunk(records: list[dict], path: Path) -> int:
    if not records:
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        for record in records:
            line = json.dumps(record, ensure_ascii=False)
            fh.write(line + "\n")
    return path.stat().st_size


def scan_start_id(state_file: Path, default: int) -> int:
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text(encoding="utf-8"))
            return int(state.get("next_book_id", default))
        except Exception:
            pass
    return default


def save_state(state_file: Path, next_book_id: int) -> None:
    state_file.write_text(json.dumps({"next_book_id": next_book_id}, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Download HebrewBooks PDFs and extract Hebrew text to JSONL chunks.")
    parser.add_argument("--start-id", type=int, default=1, help="Starting book ID")
    parser.add_argument("--end-id", type=int, default=69799, help="Ending book ID")
    parser.add_argument("--artifact-dir", type=Path, default=Path("artifacts"), help="Directory for JSONL artifact chunks")
    parser.add_argument("--temp-dir", type=Path, default=Path("tmp"), help="Temporary directory for downloaded PDFs")
    parser.add_argument("--max-artifact-bytes", type=int, default=2147483648, help="Maximum artifact chunk size in bytes")
    parser.add_argument("--sleep-seconds", type=float, default=1.5, help="Sleep seconds between downloads")
    parser.add_argument("--start-chunk", type=int, default=1, help="Initial chunk index")
    parser.add_argument("--state-file", type=Path, default=Path("state.json"), help="State file to resume from last book")
    args = parser.parse_args()

    session = requests.Session()
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; HebrewBooksDownloader/1.0)",
        "Accept": "application/pdf,application/octet-stream,q=0.9,*/*;q=0.8",
        "Accept-Language": "he,en-US;q=0.9,en;q=0.8",
    }

    current_book_id = scan_start_id(args.state_file, args.start_id)
    current_chunk = args.start_chunk
    artifact_path = args.artifact_dir / f"hebrewbooks_{current_chunk:04d}.jsonl"
    current_size = artifact_path.stat().st_size if artifact_path.exists() else 0

    print(f"Starting from book {current_book_id}, artifact chunk {artifact_path}")

    for book_id in range(current_book_id, args.end_id + 1):
        pdf_path = download_pdf(book_id, args.temp_dir, session, headers)
        if pdf_path is None:
            time.sleep(args.sleep_seconds)
            args.state_file.write_text(json.dumps({"next_book_id": book_id + 1}, ensure_ascii=False), encoding="utf-8")
            continue

        try:
            title, pages = extract_book_text(pdf_path)
        except Exception as exc:
            print(f"[error] failed to parse PDF for book {book_id}: {exc}")
            pdf_path.unlink(missing_ok=True)
            time.sleep(args.sleep_seconds)
            args.state_file.write_text(json.dumps({"next_book_id": book_id + 1}, ensure_ascii=False), encoding="utf-8")
            continue

        if not pages:
            print(f"[skip] no readable text in book {book_id}")
            pdf_path.unlink(missing_ok=True)
            time.sleep(args.sleep_seconds)
            args.state_file.write_text(json.dumps({"next_book_id": book_id + 1}, ensure_ascii=False), encoding="utf-8")
            continue

        records = [build_record(book_id, title, p) for p in pages]
        temp_chunk_path = args.artifact_dir / f"hebrewbooks_{current_chunk:04d}.jsonl"

        # split chunk if it would exceed max size
        for record in records:
            line = json.dumps(record, ensure_ascii=False) + "\n"
            line_bytes = line.encode("utf-8")
            if current_size + len(line_bytes) > args.max_artifact_bytes:
                print(f"Chunk {current_chunk:04d} reached {current_size} bytes, rotating to next chunk")
                current_chunk += 1
                artifact_path = args.artifact_dir / f"hebrewbooks_{current_chunk:04d}.jsonl"
                current_size = artifact_path.stat().st_size if artifact_path.exists() else 0
            artifact_path.parent.mkdir(parents=True, exist_ok=True)
            with open(artifact_path, "ab") as fh:
                fh.write(line_bytes)
            current_size += len(line_bytes)

        pdf_path.unlink(missing_ok=True)
        args.state_file.write_text(json.dumps({"next_book_id": book_id + 1}, ensure_ascii=False), encoding="utf-8")
        print(f"[ok] book {book_id} -> {artifact_path.name} ({current_size} bytes)")
        time.sleep(args.sleep_seconds)

    print(f"Finished processing up to {args.end_id}. last chunk {current_chunk:04d} size {current_size}")


if __name__ == "__main__":
    main()
