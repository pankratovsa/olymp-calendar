#!/usr/bin/env python3
"""Добавить олимпиаду из MD-файла в site/data/olympiads.json без пересборки HTML.

Использование:
  python3 scripts/add_olympiad.py data/new_olymp.md
  python3 scripts/add_olympiad.py --sync-all   # все файлы из data/

Страница читает только olympiads.json — HTML/CSS/JS не трогаются.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUT_PATH = ROOT / "site" / "data" / "olympiads.json"

# Учебный год в JSON — ориентир; на сайте день/месяц пересчитываются
# относительно выбранной «текущей даты» (сен–дек = yearStart, янв–авг = yearStart+1).
YEAR_START = 2025

SECTION_ALIASES = {
    "название": "title",
    "короткое название": "shortTitle",
    "предмет": "subjects",
    "классы": "grades",
    "описание": "description",
    "сайт": "website",
    "туры": "tours",
}

TOUR_ALIASES = {
    "тип": "type",
    "место проведения": "venue",
    "дата проведения": "date",
    "дата объявления": "announced",
    "дата объвления": "announced",  # опечатка в шаблоне
    "дата ю": "announced",  # усечённый заголовок
}


def slugify(path: Path) -> str:
    return path.stem


def normalize_heading(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def split_list(text: str) -> list[str]:
    parts = re.split(r"[,;/]+", text)
    return [p.strip() for p in parts if p.strip()]


def parse_grades(text: str) -> list[int]:
    grades: list[int] = []
    for token in re.split(r"[,;\s]+", text.strip()):
        if token.isdigit():
            grades.append(int(token))
    return grades


def parse_date_token(token: str) -> tuple[int, int, int | None] | None:
    token = token.strip()
    m = re.match(r"^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$", token)
    if not m:
        return None
    day, month = int(m.group(1)), int(m.group(2))
    year = int(m.group(3)) if m.group(3) else None
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    return day, month, year


def parse_time_suffix(text: str) -> dict | None:
    """Время после даты: 11:00 msk или диапазон 10:00-15:00 msk (только с ':')."""
    text = text.strip()
    m = re.search(
        r"(?<!\d)(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})\s*([A-Za-zА-Яа-яЁё]{2,5})?\s*$",
        text,
        flags=re.IGNORECASE,
    )
    if m:
        h1, mi1 = int(m.group(1)), int(m.group(2))
        h2, mi2 = int(m.group(3)), int(m.group(4))
        if not (
            0 <= h1 <= 23
            and 0 <= mi1 <= 59
            and 0 <= h2 <= 23
            and 0 <= mi2 <= 59
        ):
            return None
        tz = m.group(5)
        return {
            "time": f"{h1:02d}:{mi1:02d}",
            "timeEnd": f"{h2:02d}:{mi2:02d}",
            "timezone": tz.upper() if tz else None,
        }

    m = re.search(
        r"(?<!\d)(\d{1,2}):(\d{2})\s*([A-Za-zА-Яа-яЁё]{2,5})?\s*$",
        text,
        flags=re.IGNORECASE,
    )
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2))
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    tz = m.group(3)
    return {
        "time": f"{hour:02d}:{minute:02d}",
        "timezone": tz.upper() if tz else None,
    }


def strip_time_suffix(text: str) -> str:
    text = text.strip()
    text = re.sub(
        r"\s+\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}(?:\s+[A-Za-zА-Яа-яЁё]{2,5})?\s*$",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()
    return re.sub(
        r"\s+\d{1,2}:\d{2}(?:\s+[A-Za-zА-Яа-яЁё]{2,5})?\s*$",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()


def to_iso(day: int, month: int, year: int | None = None) -> str:
    if year is None:
        year = YEAR_START if month >= 9 else YEAR_START + 1
    return f"{year:04d}-{month:02d}-{day:02d}"


def format_day_month(day: int, month: int) -> str:
    return f"{day}.{month:02d}"


# Актуальное событие: дата проведения с сентября 2026; объявление — после 1.06.2026.
EVENT_CONFIRMED_FROM = "2026-09-01"
ANNOUNCE_CONFIRMED_AFTER = "2026-06-01"


def announcement_accuracy(ann: dict | None) -> str:
    if not ann or not ann.get("start"):
        return "approximate"
    if ann["start"] <= ANNOUNCE_CONFIRMED_AFTER:
        return "approximate"
    return "confirmed"


def tour_date_accuracy(tour: dict) -> str:
    date = tour.get("date")
    if not date or not date.get("start"):
        return "approximate"
    if date["start"] < EVENT_CONFIRMED_FROM:
        return "approximate"
    if announcement_accuracy(tour.get("announced")) != "confirmed":
        return "approximate"
    return "confirmed"


def finalize_tour(tour: dict) -> None:
    if tour.get("date"):
        tour["date"]["accuracy"] = tour_date_accuracy(tour)
    if tour.get("announced"):
        tour["announced"]["accuracy"] = announcement_accuracy(tour["announced"])


def date_payload(
    start_iso: str,
    end_iso: str,
    raw: str,
    label_start: str,
    label_end: str,
    time_info: dict | None = None,
    year_explicit: bool = False,
) -> dict:
    multi = start_iso != end_iso
    payload = {
        "start": start_iso,
        "end": end_iso,
        "raw": raw,
        "multiDay": multi,
        "labelStart": label_start,
        "labelEnd": label_end if multi else label_start,
        "yearExplicit": year_explicit,
    }
    if time_info:
        payload["time"] = time_info["time"]
        if time_info.get("timeEnd"):
            payload["timeEnd"] = time_info["timeEnd"]
        if time_info.get("timezone"):
            payload["timezone"] = time_info["timezone"]
    return payload


def parse_date_range(raw: str) -> dict | None:
    raw = raw.strip()
    if not raw or raw.lower() == "online":
        return None

    time_info = parse_time_suffix(raw)
    date_only = strip_time_suffix(raw) if time_info else raw

    # 1.10-13.01 или 1.10 – 13.01
    parts = re.split(r"\s*[-–—]\s*", date_only)
    if len(parts) == 1:
        parsed = parse_date_token(parts[0])
        if not parsed:
            return None
        day, month, year = parsed
        year_explicit = year is not None
        iso = to_iso(day, month, year)
        label = format_day_month(day, month)
        return date_payload(iso, iso, raw, label, label, time_info, year_explicit)
    if len(parts) >= 2:
        a = parse_date_token(parts[0])
        b = parse_date_token(parts[1])
        if not a or not b:
            return None
        day_a, month_a, year_a = a
        day_b, month_b, year_b = b
        year_explicit = year_a is not None and year_b is not None
        start = to_iso(day_a, month_a, year_a)
        end = to_iso(day_b, month_b, year_b)
        if end < start:
            if year_b is None:
                end = f"{YEAR_START:04d}-{month_b:02d}-{day_b:02d}"
            if end < start and year_a is None:
                end = to_iso(day_b, month_b)
        return date_payload(
            start,
            end,
            raw,
            format_day_month(day_a, month_a),
            format_day_month(day_b, month_b),
            time_info,
            year_explicit,
        )
    return None


def normalize_tour_type(raw: str) -> str:
    t = raw.strip().lower()
    if t in {"online", "онлайн", "дистанционный", "дистанционно"}:
        return "online"
    return "offline"


def is_venue_line(ln: str) -> bool:
    """Площадка: маркированный список или вложенная (с отступом) строка."""
    if not ln.strip():
        return False
    if ln[0] in " \t":
        return True
    if re.match(r"^[\*\-•]\s+", ln):
        return True
    return False


def parse_venue(block: str) -> dict:
    """Несколько мест проведения; площадки — подбулеты или вложенные строки.

    Пример:
      Санкт-Петербург
      Москва

    Пример с площадками:
      Самара
      * Школа 6
      * ОЦ Южный Город
    """
    raw = block.strip()
    if not raw or raw.lower() == "online":
        return {"places": [], "cities": [], "city": None, "venues": [], "raw": raw}

    places: list[dict] = []
    current: dict | None = None

    for ln in block.splitlines():
        if not ln.strip():
            continue
        if is_venue_line(ln):
            clean = re.sub(r"^[\*\-•]\s*", "", ln.strip()).strip()
            if not clean:
                continue
            if current is None:
                current = {"city": clean, "venues": []}
                places.append(current)
            else:
                current["venues"].append(clean)
            continue

        clean = ln.strip()
        if clean.lower() == "online":
            continue
        current = {"city": clean, "venues": []}
        places.append(current)

    cities = [p["city"] for p in places if p.get("city")]
    venues = [v for p in places for v in p.get("venues", [])]
    return {
        "places": places,
        "cities": cities,
        "city": cities[0] if cities else None,
        "venues": venues,
        "raw": raw,
    }



def extract_sections(md: str) -> list[tuple[int, str, str]]:
    """Возвращает (level, title, body)."""
    lines = md.splitlines()
    sections: list[tuple[int, str, str]] = []
    i = 0
    while i < len(lines):
        m = re.match(r"^(#{1,3})\s+(.+?)\s*$", lines[i])
        if not m:
            i += 1
            continue
        level = len(m.group(1))
        title = m.group(2).strip()
        i += 1
        body_lines: list[str] = []
        while i < len(lines):
            if re.match(r"^#{1,3}\s+", lines[i]):
                break
            body_lines.append(lines[i])
            i += 1
        sections.append((level, title, "\n".join(body_lines).strip()))
    return sections


def extract_website(text: str) -> str | None:
    m = re.search(r"\[([^\]]+)\]\((https?://[^)]+)\)", text)
    if m:
        return m.group(2)
    m = re.search(r"(https?://\S+)", text)
    return m.group(1).rstrip(").,") if m else None


def parse_olympiad(md: str, source: str) -> dict:
    sections = extract_sections(md)
    olympiad: dict = {
        "id": Path(source).stem,
        "source": source,
        "title": "",
        "shortTitle": "",
        "subjects": [],
        "grades": [],
        "description": "",
        "website": None,
        "tours": [],
    }

    # Собираем поля уровня ## и описание до # Туры
    i = 0
    while i < len(sections):
        level, title, body = sections[i]
        key = SECTION_ALIASES.get(normalize_heading(title))

        if level == 1 and normalize_heading(title) == "название":
            olympiad["title"] = body.strip().strip('"').strip()
            i += 1
            continue

        if level == 1 and key == "tours":
            i += 1
            # ## Тур → ### поля
            while i < len(sections):
                lvl, ttitle, tbody = sections[i]
                if lvl == 1:
                    break
                if lvl == 2:
                    tour: dict = {
                        "name": ttitle.strip(),
                        "type": "offline",
                        "city": None,
                        "cities": [],
                        "places": [],
                        "venues": [],
                        "date": None,
                        "announced": None,
                    }
                    i += 1
                    while i < len(sections) and sections[i][0] == 3:
                        flvl, ftitle, fbody = sections[i]
                        fkey = TOUR_ALIASES.get(normalize_heading(ftitle))
                        if fkey == "type":
                            tour["type"] = normalize_tour_type(fbody)
                        elif fkey == "venue":
                            venue = parse_venue(fbody)
                            tour["places"] = venue["places"]
                            tour["cities"] = venue["cities"]
                            tour["city"] = venue["city"]
                            tour["venues"] = venue["venues"]
                            if tour["type"] == "online":
                                tour["places"] = []
                                tour["cities"] = []
                                tour["city"] = None
                                tour["venues"] = []
                        elif fkey == "date":
                            tour["date"] = parse_date_range(fbody)
                        elif fkey == "announced":
                            tour["announced"] = parse_date_range(fbody)
                        i += 1
                    finalize_tour(tour)
                    olympiad["tours"].append(tour)
                    continue
                i += 1
            continue

        if level == 2 and key == "shortTitle":
            olympiad["shortTitle"] = body.strip()
        elif level == 2 and key == "subjects":
            olympiad["subjects"] = split_list(body)
        elif level == 2 and key == "grades":
            olympiad["grades"] = parse_grades(body)
        elif level == 2 and key == "description":
            # описание может содержать ### Сайт
            desc = body
            # если следующий section — сайт
            olympiad["description"] = re.sub(
                r"###\s*Сайт[\s\S]*$", "", desc, flags=re.IGNORECASE
            ).strip()
            site = extract_website(desc)
            if site:
                olympiad["website"] = site
        elif level in (2, 3) and key == "website":
            olympiad["website"] = extract_website(body) or body.strip() or olympiad["website"]

        i += 1

    if not olympiad["shortTitle"]:
        olympiad["shortTitle"] = olympiad["title"] or olympiad["id"]

    return olympiad


def load_json() -> list[dict]:
    if not OUT_PATH.exists():
        return []
    return json.loads(OUT_PATH.read_text(encoding="utf-8"))


def save_json(items: list[dict]) -> None:
    import hashlib
    import time

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(items, ensure_ascii=False, indent=2) + "\n"
    OUT_PATH.write_text(payload, encoding="utf-8")
    version = {
        "v": hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12],
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": len(items),
    }
    version_path = OUT_PATH.parent / "version.json"
    version_path.write_text(
        json.dumps(version, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def upsert(olympiad: dict, items: list[dict]) -> list[dict]:
    by_id = {o["id"]: o for o in items}
    by_id[olympiad["id"]] = olympiad
    # стабильный порядок: по shortTitle
    return sorted(by_id.values(), key=lambda o: o.get("shortTitle") or o["id"])


def add_file(path: Path, items: list[dict]) -> list[dict]:
    md = path.read_text(encoding="utf-8")
    try:
        rel = str(path.relative_to(ROOT))
    except ValueError:
        rel = str(path)
    olympiad = parse_olympiad(md, rel)
    return upsert(olympiad, items)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("md_file", nargs="?", help="Путь к MD-файлу олимпиады")
    parser.add_argument(
        "--sync-all",
        action="store_true",
        help="Пересобрать JSON из всех *.md в data/",
    )
    args = parser.parse_args()

    if args.sync_all:
        items: list[dict] = []
        files = sorted(DATA_DIR.glob("*.md"))
        if not files:
            print(f"Нет файлов в {DATA_DIR}", file=sys.stderr)
            return 1
        for path in files:
            items = add_file(path, items)
            print(f"+ {path.name} → {path.stem}")
        save_json(items)
        print(f"Записано {len(items)} олимпиад → {OUT_PATH.relative_to(ROOT)}")
        return 0

    if not args.md_file:
        parser.print_help()
        return 1

    path = Path(args.md_file).expanduser().resolve()
    if not path.exists():
        print(f"Файл не найден: {path}", file=sys.stderr)
        return 1

    items = load_json()
    items = add_file(path, items)
    save_json(items)
    print(f"Добавлено/обновлено: {path.stem}")
    print(f"Всего олимпиад: {len(items)} → {OUT_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
