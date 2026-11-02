// The Charts tab: a donut of where the money went, and income against expense by day.
// Colours come from the --series values in style.css. A category keeps its colour for the
// month it is shown in, and its name and icon always sit beside it, so colour never works alone.

const DONUT_SLOTS = 5; // the five biggest, then one grey slice for the rest
const DONUT = { size: 260, radius: 78, width: 28, gap: 2, badge: 111 };
const TREND = { width: 320, height: 200, left: 44, right: 10, top: 12, bottom: 24 };

let trend = null; // the numbers behind the line chart, for the crosshair

function compact(satang) {
  const sign = satang < 0 ? "-" : "";
  const baht = Math.abs(satang) / 100;
  if (baht >= 1000000) return `${sign}${+(baht / 1000000).toFixed(1)}M`;
  if (baht >= 1000) return `${sign}${+(baht / 1000).toFixed(1)}K`;
  return `${sign}${Math.round(baht)}`;
}

function percent(part, whole) {
  const value = (part / whole) * 100;
  return value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`;
}

function categoryTotals(kind) {
  const totals = new Map();
  monthEntries().filter((row) => row.kind === kind).forEach((row) => {
    totals.set(row.category_id, (totals.get(row.category_id) ?? 0) + row.amount);
  });
  return [...totals]
    .map(([id, total]) => ({ id, total, category: find("categories", id) }))
    .sort((a, b) => b.total - a.total);
}

function renderCharts() {
  const modes = [["expense", t("expense")], ["income", t("income")], ["trend", t("trend")]].map(([mode, label]) => `
    <button data-act="chart-mode" data-mode="${mode}" class="${state.chartMode === mode ? "on" : ""}">${label}</button>`).join("");
  return `
    <header class="hero">
      <div class="hero-title"><h1>${t("charts")}</h1><span class="hero-note">${esc(currentBook().name)}</span></div>
      <div class="seg seg-hero">${modes}</div>
    </header>
    <main class="body">
      <section class="card chart-card">
        ${monthNav()}
        ${state.chartMode === "trend" ? renderTrend() : renderDonut(state.chartMode)}
      </section>
      ${state.chartMode === "trend" ? renderTrendTable() : renderCategoryTable(state.chartMode)}
    </main>`;
}

function chartEmpty() {
  return `<div class="empty"><div class="emoji" aria-hidden="true">🌱</div><strong>${t("noEntries")}</strong></div>`;
}

function slicesOf(rows) {
  const slices = rows.slice(0, DONUT_SLOTS).map((row, i) => ({ ...row, color: `var(--series-${i + 1})` }));
  const rest = rows.slice(DONUT_SLOTS);
  if (rest.length) {
    slices.push({ id: "other", total: rest.reduce((sum, row) => sum + row.total, 0), color: "var(--series-other)", tail: rest });
  }
  return slices;
}

function pickedSlice(slices) {
  if (!state.pick) return null;
  return slices.find((slice) => slice.id === state.pick) ?? slices.find((slice) => slice.tail?.some((row) => row.id === state.pick));
}

function renderDonut(kind) {
  const rows = categoryTotals(kind);
  if (!rows.length) return chartEmpty();
  const slices = slicesOf(rows);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const picked = pickedSlice(slices);
  const { size, radius, width, gap, badge } = DONUT;
  const middle = size / 2;
  const round = 2 * Math.PI * radius;
  let used = 0;

  const marks = slices.map((slice) => {
    const share = slice.total / total;
    const length = slices.length > 1 ? Math.max(share * round - gap, 1) : round;
    const angle = (used + share / 2) * 2 * Math.PI - Math.PI / 2;
    const ring = `<circle class="slice" data-act="slice" data-id="${slice.id}" cx="${middle}" cy="${middle}" r="${radius}"
      fill="none" stroke-width="${width}" style="stroke:${slice.color}; opacity:${!picked || picked === slice ? 1 : 0.3}"
      stroke-dasharray="${length} ${round - length}" stroke-dashoffset="${-used * round}"
      transform="rotate(-90 ${middle} ${middle})"></circle>`;
    const icon = slice.category && share >= 0.06 ? `
      <text x="${middle + badge * Math.cos(angle)}" y="${middle + badge * Math.sin(angle)}" text-anchor="middle"
        dominant-baseline="central" font-size="22" aria-hidden="true">${esc(slice.category.icon)}</text>` : "";
    used += share;
    return ring + icon;
  }).join("");

  const pickedRow = rows.find((row) => row.id === state.pick);
  const name = pickedRow ? categoryName(pickedRow.category) : picked ? t("smaller") : t(kind);
  const amount = pickedRow ? pickedRow.total : picked ? picked.total : total;
  return `
    <div class="donut">
      <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(`${t(kind)} ${money(total)}`)}">${marks}</svg>
      <div class="donut-center"><span>${esc(name)}</span><b>${money(amount)}</b>${picked ? `<span>${percent(amount, total)}</span>` : ""}</div>
    </div>`;
}

function renderCategoryTable(kind) {
  const rows = categoryTotals(kind);
  if (!rows.length) return "";
  const slices = slicesOf(rows);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  return `
    <section class="card chart-list">
      ${rows.map((row, i) => `
        <button class="entry cat-row ${state.pick === row.id ? "on" : ""}" data-act="slice" data-id="${row.id}" aria-pressed="${state.pick === row.id}">
          <i class="line-key" style="background:${i < DONUT_SLOTS ? slices[i].color : "var(--series-other)"}"></i>
          <span class="bubble" aria-hidden="true">${esc(row.category.icon)}</span>
          <span class="entry-main"><div>${esc(categoryName(row.category))}</div></span>
          <span class="cat-share">${percent(row.total, total)}</span>
          <span class="entry-amount">${money(row.total)}</span>
        </button>`).join("")}
    </section>`;
}

function dailyTotals() {
  const days = new Date(state.year, state.month, 0).getDate();
  const income = new Array(days).fill(0);
  const expense = new Array(days).fill(0);
  monthEntries().forEach((row) => {
    const day = Number(row.occurred_on.slice(8)) - 1;
    if (row.kind === "income") income[day] += row.amount;
    if (row.kind === "expense") expense[day] += row.amount;
  });
  return { income, expense };
}

// The last day to draw. Days that haven't happened yet are left off, not drawn as zero.
function lastTrendDay({ income, expense }) {
  const today = localDate();
  const todayDay = today.startsWith(monthPrefix()) ? Number(today.slice(8)) : 0;
  const isPast = monthPrefix() < today.slice(0, 7);
  let last = isPast ? income.length : todayDay;
  income.forEach((value, i) => {
    if ((value || expense[i]) && i + 1 > last) last = i + 1;
  });
  return last;
}

function niceMax(value) {
  const size = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map((step) => step * size).find((step) => step >= value);
}

function renderTrend() {
  const daily = dailyTotals();
  const last = lastTrendDay(daily);
  const income = daily.income.slice(0, last);
  const expense = daily.expense.slice(0, last);
  if (!income.some(Boolean) && !expense.some(Boolean)) {
    trend = null;
    return chartEmpty();
  }
  const { width, height, left, right, top, bottom } = TREND;
  const max = niceMax(Math.max(...income, ...expense));
  const floor = height - bottom;
  const x = (day) => (last === 1 ? (left + width - right) / 2 : left + ((day - 1) / (last - 1)) * (width - left - right));
  const y = (value) => floor - (value / max) * (floor - top);
  const path = (values) => values.map((value, i) => `${i ? "L" : "M"}${x(i + 1).toFixed(1)} ${y(value).toFixed(1)}`).join("");
  trend = { income, expense, last, x, y };

  const grid = [0, max / 2, max].map((value) => `
    <line class="${value ? "grid" : "axis"}" x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"></line>
    <text class="tick" x="${left - 6}" y="${y(value)}" text-anchor="end" dominant-baseline="central">${compact(value)}</text>`).join("");
  const days = [1, 8, 15, 22, last].filter((day, i, list) => day <= last && (day === last || last - day >= 4) && list.indexOf(day) === i);
  const labels = days.map((day) => `<text class="tick" x="${x(day)}" y="${height - 6}" text-anchor="middle">${day}</text>`).join("");
  const dots = last === 1
    ? `<circle class="line-dot" cx="${x(1)}" cy="${y(income[0])}" r="4" style="fill:var(--income)"></circle>
       <circle class="line-dot" cx="${x(1)}" cy="${y(expense[0])}" r="4" style="fill:var(--expense)"></circle>`
    : "";
  const sum = (values) => values.reduce((total, value) => total + value, 0);

  return `
    <div class="legend">
      <span><i class="line-key flat" style="background:var(--income)"></i>${t("income")} <b>${money(sum(income))}</b></span>
      <span><i class="line-key flat" style="background:var(--expense)"></i>${t("expense")} <b>${money(sum(expense))}</b></span>
    </div>
    <div class="trend-wrap">
      <svg id="trend" viewBox="0 0 ${width} ${height}" tabindex="0" role="img"
        aria-label="${esc(`${t("income")} ${money(sum(income))}, ${t("expense")} ${money(sum(expense))}`)}">
        ${grid}${labels}
        <path class="line" d="${path(income)}" style="stroke:var(--income)"></path>
        <path class="line" d="${path(expense)}" style="stroke:var(--expense)"></path>
        ${dots}
        <g id="trend-cross" style="display:none">
          <line class="cross" y1="${top}" y2="${floor}"></line>
          <circle class="line-dot" data-series="income" r="4" style="fill:var(--income)"></circle>
          <circle class="line-dot" data-series="expense" r="4" style="fill:var(--expense)"></circle>
        </g>
      </svg>
      <div class="tip" id="trend-tip" hidden></div>
    </div>`;
}

function renderTrendTable() {
  const { income, expense } = dailyTotals();
  const rows = income.map((value, i) => ({ day: i + 1, income: value, expense: expense[i] }))
    .filter((row) => row.income || row.expense)
    .reverse();
  if (!rows.length) return "";
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  const cell = (row, label) => `
    <tr>
      <th scope="row">${label}</th>
      <td>${money(row.income)}</td>
      <td>${money(row.expense)}</td>
      <td class="${row.income < row.expense ? "neg" : "pos"}">${money(row.income - row.expense)}</td>
    </tr>`;
  const dayName = (day) => dateLabel(`${monthPrefix()}-${String(day).padStart(2, "0")}`);
  return `
    <section class="card chart-list">
      <table class="trend-table">
        <thead><tr><th scope="col">${t("date")}</th><th scope="col">${t("income")}</th><th scope="col">${t("expense")}</th><th scope="col">${t("total")}</th></tr></thead>
        <tbody>
          ${cell({ income: sum("income"), expense: sum("expense") }, t("total"))}
          ${rows.map((row) => cell(row, esc(dayName(row.day)))).join("")}
        </tbody>
      </table>
    </section>`;
}

function showTrendDay(index) {
  const chart = document.querySelector("#trend");
  const cross = document.querySelector("#trend-cross");
  const tip = document.querySelector("#trend-tip");
  const x = trend.x(index + 1);
  trend.index = index;
  cross.style.display = "";
  cross.querySelector("line").setAttribute("x1", x);
  cross.querySelector("line").setAttribute("x2", x);
  cross.querySelectorAll("circle").forEach((dot) => {
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", trend.y(trend[dot.dataset.series][index]));
  });
  tip.hidden = false;
  tip.textContent = "";
  const title = document.createElement("div");
  title.textContent = dateLabel(`${monthPrefix()}-${String(index + 1).padStart(2, "0")}`);
  tip.append(title);
  ["income", "expense"].forEach((series) => {
    const line = document.createElement("div");
    const key = document.createElement("i");
    const value = document.createElement("b");
    key.className = "line-key flat";
    key.style.background = `var(--${series})`;
    value.textContent = money(trend[series][index]);
    line.append(key, value, ` ${t(series)}`);
    tip.append(line);
  });
  const box = chart.getBoundingClientRect();
  const position = (x / TREND.width) * box.width;
  tip.style.left = position > box.width / 2 ? "" : `${position + 10}px`;
  tip.style.right = position > box.width / 2 ? `${box.width - position + 10}px` : "";
}

function hideTrendDay() {
  document.querySelector("#trend-cross").style.display = "none";
  document.querySelector("#trend-tip").hidden = true;
}

function bindTrend() {
  const chart = document.querySelector("#trend");
  if (!chart) return;
  const fromPointer = (event) => {
    const box = chart.getBoundingClientRect();
    const position = ((event.clientX - box.left) / box.width) * TREND.width;
    const share = (position - TREND.left) / (TREND.width - TREND.left - TREND.right);
    showTrendDay(Math.min(trend.last - 1, Math.max(0, Math.round(share * (trend.last - 1)))));
  };
  chart.addEventListener("pointerdown", fromPointer);
  chart.addEventListener("pointermove", fromPointer);
  chart.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") hideTrendDay();
  });
  // A tap also focuses the chart, and must keep the day that was tapped.
  chart.addEventListener("focus", () => {
    if (chart.matches(":focus-visible")) showTrendDay(trend.last - 1);
  });
  chart.addEventListener("blur", hideTrendDay);
  chart.addEventListener("keydown", (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    showTrendDay(Math.min(trend.last - 1, Math.max(0, trend.index + step)));
  });
}
