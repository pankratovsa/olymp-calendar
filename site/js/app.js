const state = {
  olympiads: [],
  currentDate: toISODate(new Date()),
  hidePast: false,
  filters: {
    cities: new Set(),
    grades: new Set(),
    subjects: new Set(),
    types: new Set(),
  },
};

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Учебный год относительно «текущей даты»:
 * месяцы 9–12 → этот календарный год,
 * месяцы 1–7 → учебный год, начавшийся в прошлом сентябре,
 * август → следующий учебный год (сезон ещё впереди, ничего не прошедшее).
 * Даты туров без года: сен–дек = yearStart, янв–авг = yearStart+1.
 */
function academicYearStart(currentISO = state.currentDate) {
  const d = parseISO(currentISO);
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  if (month >= 9) return year;
  if (month === 8) return year;
  return year - 1;
}

function resolveDayMonth(day, month, yearStart) {
  const y = month >= 9 ? yearStart : yearStart + 1;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Берём день/месяц из ISO и вешаем на учебный год «текущей даты». */
function resolveISOToAcademic(iso, yearStart = academicYearStart()) {
  const d = parseISO(iso);
  return resolveDayMonth(d.getDate(), d.getMonth() + 1, yearStart);
}

function displaySeasonYearStart() {
  return academicYearStart();
}

/** Примерные даты (прошлый сезон) → тот же день/месяц в текущем уч. году календаря. */
function mapToDisplaySeason(iso) {
  const d = parseISO(iso);
  return resolveDayMonth(d.getDate(), d.getMonth() + 1, displaySeasonYearStart());
}

function resolveDateForCalendar(dateObj) {
  if (!dateObj?.start) return null;
  if (dateObj.accuracy === "confirmed") {
    return { start: dateObj.start, end: dateObj.end || dateObj.start };
  }
  return {
    start: mapToDisplaySeason(dateObj.start),
    end: mapToDisplaySeason(dateObj.end || dateObj.start),
  };
}

function tourResolvedDates(tour) {
  if (!tour.date?.start || !tour.date?.end) return null;
  return resolveDateForCalendar(tour.date);
}

function resolvedAnnouncedDate(tour) {
  if (!tour.announced?.start) return null;
  const resolved = resolveDateForCalendar(tour.announced);
  return resolved?.start ?? null;
}

function olympiadEarliestStart(olympiad) {
  let min = null;
  for (const t of olympiad.tours || []) {
    const resolved = tourResolvedDates(t);
    if (!resolved) continue;
    if (!min || resolved.start < min) min = resolved.start;
  }
  return min;
}

function isWinkid(olympiad) {
  return olympiad.id === "winkid" || /winkid/i.test(olympiad.shortTitle || "");
}

/** Колонки — только по дате первого тура (раньше слева). */
function orderedOlympiads() {
  return [...state.olympiads].sort((a, b) => {
    const as = olympiadEarliestStart(a) || "9999-12-31";
    const bs = olympiadEarliestStart(b) || "9999-12-31";
    if (as !== bs) return as.localeCompare(bs);
    return (a.shortTitle || "").localeCompare(b.shortTitle || "", "ru");
  });
}

function formatShort(date) {
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function formatDayMonth(iso) {
  const d = parseISO(iso);
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatTourTime(dateObj) {
  if (!dateObj?.time) return "";
  const range = dateObj.timeEnd
    ? `${dateObj.time}–${dateObj.timeEnd}`
    : dateObj.time;
  const tz = dateObj.timezone ? ` ${dateObj.timezone}` : "";
  return `${range}${tz}`;
}

function renderDateAccuracy(dateObj) {
  if (!dateObj?.accuracy) return "";
  const confirmed = dateObj.accuracy === "confirmed";
  const cls = confirmed
    ? "date-badge date-badge--confirmed"
    : "date-badge date-badge--approximate";
  const title = confirmed
    ? "Дата актуальная (сентябрь 2026 и позже, объявление после 1.06.2026)"
    : "Дата примерная (прошлый уч. год или ещё не объявлено)";
  const icon = confirmed ? "✓" : "?";
  return `<span class="${cls}" title="${title}" aria-label="${title}">${icon}</span>`;
}

function tourDateLabels(tour, { includeTime = true } = {}) {
  if (!tour.date) return { multiDay: false, start: "", end: "", time: "" };
  const start = formatDayMonth(tour.date.start);
  const end = formatDayMonth(tour.date.end);
  const multiDay =
    typeof tour.date.multiDay === "boolean"
      ? tour.date.multiDay
      : tour.date.start !== tour.date.end;
  const time = includeTime ? formatTourTime(tour.date) : "";
  return { multiDay, start, end, time };
}

function formatTourDateText(tour) {
  const labels = tourDateLabels(tour);
  if (!labels.start) return "—";
  const range = labels.multiDay
    ? `${labels.start} – ${labels.end}`
    : labels.start;
  return labels.time ? `${range}, ${labels.time}` : range;
}


function renderTourDates(tour) {
  const { multiDay, start, end, time } = tourDateLabels(tour);
  if (!start) return "";
  const timeHtml = time
    ? ` <span class="tour-date__time">${escapeHtml(time)}</span>`
    : "";
  if (!multiDay) {
    return `<span class="tour-date tour-date--single">${escapeHtml(start)}${renderDateAccuracy(tour.date)}${timeHtml}</span>`;
  }
  return `
    <span class="tour-date tour-date--range">
      <span class="tour-date__edge tour-date__edge--start">${escapeHtml(start)}${renderDateAccuracy(tour.date)}</span>
      <span class="tour-date__sep">–</span>
      <span class="tour-date__edge tour-date__edge--end">${escapeHtml(end)}</span>${timeHtml}
    </span>`;
}

function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function weekKey(date) {
  const d = startOfWeek(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function announcementDisplayDate(tour) {
  const iso = resolvedAnnouncedDate(tour);
  if (!iso) return null;
  const seasonStart = `${displaySeasonYearStart()}-09-01`;
  return iso < seasonStart ? seasonStart : iso;
}

function buildWeeks(olympiads) {
  let min = null;
  let max = null;
  for (const o of olympiads) {
    for (const t of o.tours) {
      const resolved = tourResolvedDates(t);
      if (resolved) {
        if (!(state.hidePast && resolved.end < state.currentDate)) {
          const s = parseISO(resolved.start);
          const e = parseISO(resolved.end);
          if (!min || s < min) min = s;
          if (!max || e > max) max = e;
        }
      }
      const ann = announcementDisplayDate(t);
      if (ann) {
        if (state.hidePast && ann < state.currentDate) continue;
        const a = parseISO(ann);
        if (!min || a < min) min = a;
        if (!max || a > max) max = a;
      }
    }
  }
  if (!min || !max) return [];
  const seasonStart = parseISO(`${displaySeasonYearStart()}-09-01`);
  if (seasonStart < min) min = seasonStart;

  const weeks = [];
  let cursor = startOfWeek(min);
  const last = startOfWeek(max);
  while (cursor <= last) {
    weeks.push({
      key: weekKey(cursor),
      start: new Date(cursor),
      end: addDays(cursor, 6),
    });
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

function announcementWeekIndex(tour, weeks) {
  const iso = announcementDisplayDate(tour);
  if (!iso || !weeks.length) return -1;
  const start = startOfWeek(parseISO(iso)).getTime();
  return weeks.findIndex((w) => w.start.getTime() === start);
}

/** Звезда на туре только если дата объявления совпадает с датой тура. */
function shouldMergeAnnouncementOnTour(tour) {
  const annIso = announcementDisplayDate(tour);
  const resolved = tourResolvedDates(tour);
  if (!annIso || !resolved) return false;
  return annIso === resolved.start;
}

function announcementIntersectsTour(tour, weeks) {
  const annWi = announcementWeekIndex(tour, weeks);
  const tourSpan = tourWeekSpan(tour, weeks);
  if (annWi < 0 || !tourSpan) return { annWi, tourSpan, intersects: false };
  const intersects = annWi >= tourSpan.from && annWi <= tourSpan.to;
  return { annWi, tourSpan, intersects };
}

function placeStandaloneAnnouncement(map, occupied, annWi, entry) {
  const existing = map.get(annWi);
  if (existing?.kind === "skip") return false;

  if (!existing) {
    map.set(annWi, {
      kind: "start",
      rowspan: 1,
      tours: [],
      announcements: [entry],
    });
    occupied.add(annWi);
  } else if (existing.kind === "start") {
    if (!existing.announcements) existing.announcements = [];
    if (existing.announcements.some((a) => !a.onTour)) return false;
    existing.announcements.push(entry);
  } else {
    return false;
  }
  return true;
}

function placeAnnouncementOnTourHost(map, tourSpan, entry) {
  const host = map.get(tourSpan.from);
  if (host?.kind !== "start") return false;
  if (!host.announcements) host.announcements = [];
  if (host.announcements.some((a) => a.onTour)) return false;
  host.announcements.push({ ...entry, onTour: true });
  return true;
}

function placeAnnouncementBesideSpanningTour(map, tourSpan, entry) {
  const host = map.get(tourSpan.from);
  if (host?.kind !== "start") return false;
  if (!host.announcements) host.announcements = [];
  if (host.announcements.some((a) => !a.onTour)) return false;
  host.announcements.push(entry);
  return true;
}

function tourWeekSpan(tour, weeks) {
  const resolved = tourResolvedDates(tour);
  if (!resolved || !weeks.length) return null;
  const start = startOfWeek(parseISO(resolved.start));
  const end = startOfWeek(parseISO(resolved.end));
  let from = -1;
  let to = -1;
  weeks.forEach((w, i) => {
    if (w.start.getTime() === start.getTime()) from = i;
    if (w.start.getTime() === end.getTime()) to = i;
  });
  if (from === -1 || to === -1) return null;
  return { from, to, rowspan: to - from + 1 };
}

function isTourPast(tour) {
  const resolved = tourResolvedDates(tour);
  if (!resolved) return false;
  return resolved.end < state.currentDate;
}

function isOlympiadPast(olympiad) {
  const dated = olympiad.tours.filter((t) => t.date?.end);
  if (!dated.length) return false;
  return dated.every(isTourPast);
}

function tourCities(tour) {
  if (Array.isArray(tour.cities) && tour.cities.length) return tour.cities;
  if (Array.isArray(tour.places) && tour.places.length) {
    return tour.places.map((p) => p.city).filter(Boolean);
  }
  return tour.city ? [tour.city] : [];
}

function tourPlaces(tour) {
  if (Array.isArray(tour.places) && tour.places.length) {
    return sortCitiesFirst(tour.places.map((p) => p.city)).map((city) => {
      const found = tour.places.find((p) => p.city === city);
      return found || { city, venues: [] };
    });
  }
  const cities = sortCitiesFirst(tourCities(tour));
  if (!cities.length) return [];
  if (cities.length === 1) {
    return [{ city: cities[0], venues: tour.venues || [] }];
  }
  return cities.map((city) => ({ city, venues: [] }));
}

function sortCitiesFirst(cities) {
  return [...cities].sort((a, b) => {
    if (a === "Самара") return -1;
    if (b === "Самара") return 1;
    return a.localeCompare(b, "ru");
  });
}

function hasFormatFilter() {
  const { cities, types } = state.filters;
  return types.has("online") || types.has("offline") || cities.size > 0;
}

/** Онлайн / очный+города — в одной группе, условия через ИЛИ. */
function tourMatchesFormat(tour) {
  if (!hasFormatFilter()) return true;
  if (tour.type === "online") {
    return state.filters.types.has("online");
  }
  if (state.filters.cities.size) {
    return tourCities(tour).some((c) => state.filters.cities.has(c));
  }
  return state.filters.types.has("offline");
}

function matchesFilters(olympiad) {
  const { grades, subjects } = state.filters;

  if (subjects.size) {
    const ok = olympiad.subjects.some((s) => subjects.has(s));
    if (!ok) return false;
  }

  if (grades.size) {
    const ok = olympiad.grades.some((g) => grades.has(String(g)));
    if (!ok) return false;
  }

  if (hasFormatFilter()) {
    const ok = olympiad.tours.some((t) => tourMatchesFormat(t));
    if (!ok) return false;
  }

  return true;
}

function tourMatchesFilters(olympiad, tour) {
  if (!matchesFilters(olympiad)) return false;
  return tourMatchesFormat(tour);
}

function collectFilterOptions(olympiads) {
  const cities = new Set();
  const grades = new Set();
  const subjects = new Set();
  for (const o of olympiads) {
    o.subjects.forEach((s) => subjects.add(s));
    o.grades.forEach((g) => grades.add(g));
    o.tours.forEach((t) => {
      tourCities(t).forEach((c) => cities.add(c));
    });
  }
  return {
    cities: sortCitiesFirst(cities),
    grades: [...grades].sort((a, b) => a - b),
    subjects: [...subjects].sort((a, b) => a.localeCompare(b, "ru")),
    types: [
      { id: "online", label: "Онлайн" },
      { id: "offline", label: "Очный" },
    ],
  };
}

function renderMarkers(tour) {
  const typeLabel = tour.type === "online" ? "Онлайн" : "Очный";
  const typeClass = tour.type === "online" ? "marker--online" : "marker--offline";
  let html = `<span class="marker ${typeClass}">${typeLabel}</span>`;
  if (tour.type === "offline") {
    for (const city of sortCitiesFirst(tourCities(tour))) {
      html += `<span class="marker marker--city">${escapeHtml(city)}</span>`;
    }
  }
  return html;
}

function allFilterCities() {
  return collectFilterOptions(state.olympiads).cities;
}

function toggleFilterChip(group, value) {
  if (group === "types" && value === "offline") {
    if (state.filters.types.has("offline")) {
      state.filters.types.delete("offline");
      state.filters.cities.clear();
    } else {
      state.filters.types.add("offline");
      allFilterCities().forEach((c) => state.filters.cities.add(c));
    }
    return;
  }

  if (group === "cities") {
    const set = state.filters.cities;
    if (set.has(value)) set.delete(value);
    else set.add(value);
    if (set.size === 0) state.filters.types.delete("offline");
    else state.filters.types.add("offline");
    return;
  }

  const set = state.filters[group];
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chipHtml(group, item) {
  const active = state.filters[group].has(item.id) ? " is-active" : "";
  return `
    <button type="button" class="chip${active}" data-group="${group}" data-value="${escapeHtml(item.id)}">
      ${escapeHtml(item.label)}
    </button>`;
}

function renderFilters() {
  const opts = collectFilterOptions(state.olympiads);
  const root = document.getElementById("filters");

  const formatChips = [
    ...opts.types.map((item) => chipHtml("types", item)),
    opts.cities.length
      ? `<span class="filter-chips__sep" aria-hidden="true"></span>`
      : "",
    ...opts.cities.map((c) => chipHtml("cities", { id: c, label: c })),
  ].join("");

  const groups = [
    {
      key: "subjects",
      label: "Предметы",
      html: opts.subjects.map((s) => chipHtml("subjects", { id: s, label: s })).join(""),
    },
    {
      key: "grades",
      label: "Классы",
      html: opts.grades
        .map((g) => chipHtml("grades", { id: String(g), label: `${g} кл.` }))
        .join(""),
    },
    {
      key: "format",
      label: "Формат",
      html: formatChips,
    },
  ];

  root.innerHTML = groups
    .filter((g) => g.html.trim())
    .map(
      (g) => `
      <div class="filter-group" data-group="${g.key}">
        <div class="filter-group__label">${g.label}</div>
        <div class="filter-chips">
          ${g.html}
        </div>
      </div>`
    )
    .join("");

  root.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleFilterChip(btn.dataset.group, btn.dataset.value);
      renderFilters();
      updateResetVisibility();
      applyFilters();
    });
  });

  document.getElementById("legend").innerHTML = `
    <span class="marker marker--online">Онлайн</span>
    <span class="marker marker--offline">Очный</span>
    <span class="marker marker--city">Город</span>
    <span class="date-badge date-badge--confirmed date-badge--legend" title="Дата актуальная">✓</span> актуальная
    <span class="date-badge date-badge--approximate date-badge--legend" title="Дата примерная">?</span> примерная
    <span class="announce-star announce-star--legend" title="Дата объявления">★ объявление</span>
  `;
}

function updateResetVisibility() {
  const any =
    Object.values(state.filters).some((s) => s.size > 0) || state.hidePast;
  document.getElementById("reset-filters").hidden = !any;
}

function openOlympiadDialog(olympiad) {
  const dialog = document.getElementById("olympiad-dialog");
  document.getElementById("olympiad-dialog-title").textContent = olympiad.shortTitle;

  const grades =
    olympiad.grades.length === 0
      ? "—"
      : olympiad.grades.join(", ") + " кл.";
  const subjects = olympiad.subjects.length
    ? olympiad.subjects.map(escapeHtml).join(", ")
    : "—";
  const website = olympiad.website
    ? `<div><dt>Сайт</dt><dd><a href="${escapeHtml(olympiad.website)}" target="_blank" rel="noopener">${escapeHtml(olympiad.website)}</a></dd></div>`
    : "";
  const tours = olympiad.tours
    .map((t) => {
      const dateText = formatTourDateText(t);
      const places = tourPlaces(t);
      const placeHtml = places.length
        ? `<div class="popup-tour__line">Места: ${places
            .map((p) => {
              const venues =
                p.venues && p.venues.length
                  ? ` (${p.venues.map(escapeHtml).join(", ")})`
                  : "";
              return `${escapeHtml(p.city)}${venues}`;
            })
            .join("; ")}</div>`
        : "";
      return `
        <li class="popup-tour">
          <strong>${escapeHtml(t.name)}</strong>
          <div class="popup-tour__line">${renderMarkers(t)}</div>
          <div class="popup-tour__line">Дата: ${escapeHtml(dateText)}</div>
          ${placeHtml}
        </li>`;
    })
    .join("");

  document.getElementById("olympiad-dialog-body").innerHTML = `
    <div><dt>Полное название</dt><dd>${escapeHtml(olympiad.title)}</dd></div>
    <div><dt>Предметы</dt><dd>${subjects}</dd></div>
    <div><dt>Классы</dt><dd>${escapeHtml(grades)}</dd></div>
    <div><dt>Описание</dt><dd class="popup-desc">${escapeHtml(olympiad.description).replace(/\n/g, "<br>")}</dd></div>
    ${website}
    <div>
      <dt>Туры</dt>
      <dd><ul class="popup-tours">${tours || "<li>Нет туров</li>"}</ul></dd>
    </div>
  `;
  dialog.showModal();
}

function renderCards() {
  const root = document.getElementById("cards");
  root.innerHTML = orderedOlympiads()
    .map((o) => {
      const dim = matchesFilters(o) ? "" : " is-dimmed";
      const grades =
        o.grades.length === 0
          ? ""
          : `<span class="tag">${o.grades[0]}–${o.grades[o.grades.length - 1]} кл.</span>`;
      const subjects = o.subjects
        .map((s) => `<span class="tag">${escapeHtml(s)}</span>`)
        .join("");
      const tours = o.tours
        .map(
          (t) => `
        <li class="card__tour">
          <strong>${escapeHtml(t.name)}</strong>
          ${renderMarkers(t)}
          ${t.date ? renderTourDates(t) : ""}
        </li>`
        )
        .join("");

      return `
      <article class="card${dim}${
        state.hidePast && isOlympiadPast(o) ? " is-hidden-past" : ""
      }" data-id="${escapeHtml(o.id)}">
        <div class="card__top">
          <button type="button" class="card__header" data-olympiad="${escapeHtml(o.id)}" aria-label="Открыть «${escapeHtml(o.shortTitle)}»">
            <h3 class="card__title">${escapeHtml(o.shortTitle)}${renderOlympiadDateBadges(o)}</h3>
            <p class="card__full">${escapeHtml(o.title)}</p>
          </button>
          <button type="button" class="card__toggle" aria-expanded="false" aria-controls="card-body-${escapeHtml(o.id)}" title="Развернуть">
            <span class="card__chevron" aria-hidden="true"></span>
          </button>
        </div>
        <div class="card__meta">${subjects}${grades}</div>
        <div class="card__body" id="card-body-${escapeHtml(o.id)}" hidden>
          <p class="card__desc">${escapeHtml(o.description)}</p>
          ${
            o.website
              ? `<a class="card__link" href="${escapeHtml(o.website)}" target="_blank" rel="noopener">Сайт олимпиады</a>`
              : ""
          }
          <ul class="card__tours">${tours}</ul>
        </div>
      </article>`;
    })
    .join("");

  root.querySelectorAll(".card__header").forEach((btn) => {
    btn.addEventListener("click", () => {
      const olympiad = state.olympiads.find((o) => o.id === btn.dataset.olympiad);
      if (olympiad) openOlympiadDialog(olympiad);
    });
  });

  root.querySelectorAll(".card__toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".card");
      const body = card.querySelector(".card__body");
      const open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!open));
      body.hidden = open;
      card.classList.toggle("is-expanded", !open);
      btn.title = open ? "Развернуть" : "Свернуть";
    });
  });
}

function openTourDialog(olympiad, tour) {
  const dialog = document.getElementById("tour-dialog");
  document.getElementById("dialog-title").textContent = tour.name;
  const places = tourPlaces(tour);
  const placeBlock = places.length
    ? `<div><dt>Места проведения</dt><dd>${places
        .map((p) => {
          const venues =
            p.venues && p.venues.length
              ? `: ${p.venues.map(escapeHtml).join(", ")}`
              : "";
          return `<div>${escapeHtml(p.city)}${venues}</div>`;
        })
        .join("")}</dd></div>`
    : "";
  const dateText = formatTourDateText(tour);
  document.getElementById("dialog-body").innerHTML = `
    <div><dt>Олимпиада</dt><dd>${escapeHtml(olympiad.shortTitle)}</dd></div>
    <div><dt>Формат</dt><dd>${renderMarkers(tour)}</dd></div>
    ${placeBlock}
    <div><dt>Дата проведения</dt><dd>${escapeHtml(dateText)}${renderDateAccuracy(tour.date)}</dd></div>
    <div><dt>Дата объявления</dt><dd>${
      tour.announced
        ? escapeHtml(formatDayMonth(tour.announced.start)) +
          renderDateAccuracy(tour.announced)
        : "—"
    }</dd></div>
  `;
  dialog.showModal();
}

function formatStackedTitle(shortTitle) {
  return String(shortTitle || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `<span class="cal-th__word">${escapeHtml(word)}</span>`)
    .join("");
}

function renderOlympiadDateBadges(olympiad) {
  if (!olympiad?.tours?.length) return "";
  let hasConfirmed = false;
  let hasApproximate = false;

  for (const t of olympiad.tours) {
    const acc = t?.date?.accuracy;
    if (!acc) continue;
    if (acc === "confirmed") hasConfirmed = true;
    if (acc === "approximate") hasApproximate = true;
  }

  if (!hasConfirmed && !hasApproximate) return "";

  const parts = [];
  if (hasConfirmed) {
    parts.push(
      `<span class="date-badge date-badge--confirmed" title="Дата актуальная" aria-label="Дата актуальная">✓</span>`
    );
  }
  if (hasApproximate) {
    parts.push(
      `<span class="date-badge date-badge--approximate" title="Дата примерная" aria-label="Дата примерная">?</span>`
    );
  }

  return `<span class="olympiad-date-badges">${parts.join("")}</span>`;
}

function renderCalendar() {
  const olympiads = orderedOlympiads();
  const weeks = buildWeeks(olympiads);
  const table = document.getElementById("calendar");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  thead.innerHTML = `<tr>
    <th class="cal-corner">Неделя</th>
    ${olympiads
      .map(
        (o) =>
          `<th scope="col">
            <button type="button" class="cal-th" data-olympiad="${escapeHtml(o.id)}" title="${escapeHtml(o.title || o.shortTitle)}">
              ${formatStackedTitle(o.shortTitle)}
              ${renderOlympiadDateBadges(o)}
            </button>
          </th>`
      )
      .join("")}
  </tr>`;

  thead.querySelectorAll(".cal-th").forEach((btn) => {
    btn.addEventListener("click", () => {
      const olympiad = state.olympiads.find((o) => o.id === btn.dataset.olympiad);
      if (olympiad) openOlympiadDialog(olympiad);
    });
  });

  // Многодневные туры: одна ячейка на весь диапазон недель (полный rowspan).
  // Звёзды объявлений — на неделе даты объявления (или 1.09, если раньше).
  const layouts = olympiads.map((o) => {
    const map = new Map();
    const occupied = new Set();
    const sorted = [...o.tours]
      .filter((t) => t.date)
      .filter((t) => !(state.hidePast && isTourPast(t)))
      .sort((a, b) => {
        const ra = tourResolvedDates(a);
        const rb = tourResolvedDates(b);
        return (ra?.start || "").localeCompare(rb?.start || "");
      });

    for (const tour of sorted) {
      const span = tourWeekSpan(tour, weeks);
      if (!span) continue;

      const conflictIdx = [...Array(span.rowspan).keys()]
        .map((k) => span.from + k)
        .find((i) => occupied.has(i));

      if (conflictIdx !== undefined) {
        for (let i = span.from; i >= 0; i--) {
          const cell = map.get(i);
          if (cell?.kind === "start") {
            cell.tours.push(tour);
            break;
          }
        }
        continue;
      }

      map.set(span.from, {
        kind: "start",
        rowspan: span.rowspan,
        tours: [tour],
        announcements: [],
      });
      for (let i = span.from; i <= span.to; i++) occupied.add(i);
      for (let i = span.from + 1; i <= span.to; i++) {
        map.set(i, { kind: "skip" });
      }
    }

    const starredWeeks = new Set();
    for (const tour of o.tours) {
      if (!tour.announced?.start) continue;
      if (state.hidePast && isTourPast(tour)) continue;
      const annIso = announcementDisplayDate(tour);
      if (!annIso) continue;
      if (state.hidePast && annIso < state.currentDate) continue;
      const raw = parseISO(tour.announced.start);
      const rawMonth = raw.getMonth() + 1;
      const entry = {
        tourName: tour.name,
        date: annIso,
        label: formatDayMonth(annIso),
        clamped: annIso.endsWith("-09-01") && !(rawMonth === 9 && raw.getDate() === 1),
        onTour: false,
      };

      const { annWi, tourSpan, intersects } = announcementIntersectsTour(tour, weeks);
      if (annWi < 0 || starredWeeks.has(annWi)) continue;

      const mergeOnTour = intersects && shouldMergeAnnouncementOnTour(tour);

      if (mergeOnTour && tourSpan) {
        if (placeAnnouncementOnTourHost(map, tourSpan, entry)) {
          starredWeeks.add(annWi);
        }
        continue;
      }

      // Недели не пересекаются — отдельная звезда в неделе объявления.
      // Пересекаются, но даты разные — одна отдельная звезда (не на туре).
      if (!intersects) {
        if (placeStandaloneAnnouncement(map, occupied, annWi, entry)) {
          starredWeeks.add(annWi);
        }
        continue;
      }

      // Пересечение внутри rowspan, ячейка «skip» — звезда у хост-ячейки тура.
      const existing = map.get(annWi);
      if (existing?.kind === "skip" && tourSpan) {
        if (placeAnnouncementBesideSpanningTour(map, tourSpan, entry)) {
          starredWeeks.add(annWi);
        }
        continue;
      }

      if (placeStandaloneAnnouncement(map, occupied, annWi, entry)) {
        starredWeeks.add(annWi);
      }
    }
    return map;
  });

  function announcementTitle(entry) {
    return `Объявление: ${entry.label}${entry.clamped ? " → 1.09" : ""} (${entry.tourName})`;
  }

  function renderAnnouncementStarButton(entry, olympiad) {
    const title = announcementTitle(entry);
    return `<button type="button" class="announce-star" title="${escapeHtml(title)}"
      data-olympiad="${escapeHtml(olympiad.id)}" data-tour="${escapeHtml(entry.tourName)}"
      aria-label="${escapeHtml(title)}">★</button>`;
  }

  function renderTourAnnouncementMarker(entry) {
    if (!entry) return "";
    const title = announcementTitle(entry);
    return `<span class="tour-block__announce announce-star announce-star--on-tour" title="${escapeHtml(title)}" aria-hidden="true">★</span>`;
  }

  function findTourAnnouncement(cell, tourName) {
    return (
      (cell.announcements || []).find((a) => a.tourName === tourName && a.onTour) ||
      null
    );
  }

  function renderTourButton(olympiad, tour, multiWeek, announcement) {
    const active = matchesFilters(olympiad) && tourMatchesFilters(olympiad, tour);
    const dim = active ? "" : " is-dimmed";
    const labels = tourDateLabels(tour, { includeTime: false });
    const typeClass =
      tour.type === "online" ? "tour-block--online" : "tour-block--offline";
    const spanClass = multiWeek || labels.multiDay ? " tour-block--span" : "";
    const annMarker = renderTourAnnouncementMarker(announcement);
    const annTitle = announcement ? ` — ${announcementTitle(announcement)}` : "";

    if (labels.multiDay) {
      return `
        <button type="button"
          class="tour-block ${typeClass}${spanClass}${dim}"
          data-olympiad="${escapeHtml(olympiad.id)}"
          data-tour="${escapeHtml(tour.name)}"
          title="${escapeHtml(tour.name + annTitle)}">
          ${annMarker}
          <span class="tour-block__edge tour-block__edge--start">
            <span class="tour-date tour-date--start">${escapeHtml(labels.start)}${renderDateAccuracy(tour.date)}</span>
          </span>
          <span class="tour-block__body">
            <span class="tour-block__name">${escapeHtml(tour.name)}</span>
            <span class="tour-block__meta">${renderMarkers(tour)}</span>
          </span>
          <span class="tour-block__edge tour-block__edge--end">
            <span class="tour-date tour-date--end">${escapeHtml(labels.end)}</span>
          </span>
        </button>`;
    }

    return `
      <button type="button"
        class="tour-block ${typeClass}${dim}"
        data-olympiad="${escapeHtml(olympiad.id)}"
        data-tour="${escapeHtml(tour.name)}"
        title="${escapeHtml(tour.name + annTitle)}">
        ${annMarker}
        <span class="tour-block__body">
          <span class="tour-date tour-date--single">${escapeHtml(labels.start)}${renderDateAccuracy(tour.date)}</span>
          <span class="tour-block__name">${escapeHtml(tour.name)}</span>
          <span class="tour-block__meta">${renderMarkers(tour)}</span>
        </span>
      </button>`;
  }

  tbody.innerHTML = weeks
    .map((week, wi) => {
      const label = `${formatShort(week.start)} – ${formatShort(week.end)}`;
      const cells = olympiads
        .map((o, oi) => {
          const cell = layouts[oi].get(wi);
          if (cell?.kind === "skip") return "";
          if (!cell) {
            return `<td class="cal-cell cal-cell--empty"></td>`;
          }

          const olympiadActive = matchesFilters(o);
          const multiWeek = cell.rowspan > 1;
          const standaloneAnnouncements = (cell.announcements || []).filter(
            (a) => !a.onTour
          );
          const stars = standaloneAnnouncements
            .map((entry) => renderAnnouncementStarButton(entry, o))
            .join("");
          const blocks = (cell.tours || [])
            .map((tour) =>
              renderTourButton(
                o,
                tour,
                multiWeek,
                findTourAnnouncement(cell, tour.name)
              )
            )
            .join("");
          const anyTourVisible = (cell.tours || []).some(
            (t) => olympiadActive && tourMatchesFilters(o, t)
          );
          const hasStars = (cell.announcements || []).length > 0;
          const cellDim =
            olympiadActive && (anyTourVisible || hasStars) ? "" : " is-dimmed";
          const spanClass = multiWeek ? " cal-cell--span" : "";
          const onlyStars = standaloneAnnouncements.length > 0 && !(cell.tours || []).length;
          return `<td class="cal-cell cal-cell--filled${spanClass}${
            onlyStars ? " cal-cell--announce" : ""
          }${cellDim}" rowspan="${cell.rowspan}"${
            multiWeek ? ` style="--rowspan: ${cell.rowspan}"` : ""
          }><div class="cal-cell__fill">${stars}${blocks}</div></td>`;
        })
        .join("");
      const currentIso = state.currentDate;
      const weekStart = toISODate(week.start);
      const weekEnd = toISODate(week.end);
      const isCurrentWeek =
        currentIso >= weekStart && currentIso <= weekEnd;
      return `<tr class="${
        isCurrentWeek ? "is-current-week" : ""
      }"><th class="week-label" scope="row">${label}</th>${cells}</tr>`;
    })
    .join("");

  tbody.querySelectorAll(".tour-block, .announce-star").forEach((btn) => {
    btn.addEventListener("click", () => {
      const olympiad = state.olympiads.find((o) => o.id === btn.dataset.olympiad);
      const tour = olympiad?.tours.find((t) => t.name === btn.dataset.tour);
      if (olympiad && tour) openTourDialog(olympiad, tour);
    });
  });
}

function applyFilters() {
  document.querySelectorAll(".card").forEach((card) => {
    const o = state.olympiads.find((x) => x.id === card.dataset.id);
    const dimFilter = !matchesFilters(o);
    const hide = state.hidePast && isOlympiadPast(o);
    card.classList.toggle("is-dimmed", dimFilter);
    card.classList.toggle("is-hidden-past", hide);
  });
  renderCalendar();
}

function resetFilters() {
  Object.values(state.filters).forEach((s) => s.clear());
  state.hidePast = false;
  const hidePastBtn = document.getElementById("hide-past");
  hidePastBtn.setAttribute("aria-pressed", "false");
  hidePastBtn.classList.remove("is-active");
  renderFilters();
  updateResetVisibility();
  applyFilters();
}

function bindChrome() {
  const dateInput = document.getElementById("current-date");
  dateInput.value = state.currentDate;
  dateInput.addEventListener("change", () => {
    state.currentDate = dateInput.value || toISODate(new Date());
    dateInput.value = state.currentDate;
    applyFilters();
  });

  const hidePastBtn = document.getElementById("hide-past");
  hidePastBtn.addEventListener("click", () => {
    state.hidePast = !state.hidePast;
    hidePastBtn.setAttribute("aria-pressed", String(state.hidePast));
    hidePastBtn.classList.toggle("is-active", state.hidePast);
    updateResetVisibility();
    applyFilters();
  });

  const foldBtn = document.getElementById("olympiads-toggle");
  const foldPanel = document.getElementById("olympiads-panel");
  foldBtn.addEventListener("click", () => {
    const open = foldBtn.getAttribute("aria-expanded") === "true";
    foldBtn.setAttribute("aria-expanded", String(!open));
    foldPanel.hidden = open;
  });
}

async function init() {
  const siteRoot = new URL("../", import.meta.url);
  const fetchOpts = { cache: "no-store" };
  let bust = String(Date.now());
  try {
    const verRes = await fetch(
      new URL(`data/version.json?t=${Date.now()}`, siteRoot),
      fetchOpts
    );
    if (verRes.ok) {
      const ver = await verRes.json();
      if (ver?.v) bust = ver.v;
    }
  } catch (_) {
    /* offline / first run */
  }
  const res = await fetch(
    new URL(`data/olympiads.json?v=${encodeURIComponent(bust)}`, siteRoot),
    fetchOpts
  );
  if (!res.ok) throw new Error("Не удалось загрузить data/olympiads.json");
  state.olympiads = await res.json();

  bindChrome();
  document.getElementById("reset-filters").addEventListener("click", resetFilters);

  renderFilters();
  renderCards();
  renderCalendar();
  updateResetVisibility();
}

init().catch((err) => {
  console.error(err);
  document.getElementById("cards").innerHTML =
    `<p>Не удалось загрузить данные олимпиад.</p>`;
});
