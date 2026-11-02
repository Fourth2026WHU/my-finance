// My Finance: Books, Calendar, Wallet, search and adding entries. Charts are in charts.js.
// Amounts are whole satang everywhere, and a balance is never stored: it is always
// worked out from the account's opening balance plus its entries.

const MAX_AMOUNT = 999999999999; // same limit as supabase/schema.sql
const SETTINGS_KEY = "myFinance.settings.v1";
const KIND_ORDER = ["cash", "bank", "ewallet", "credit"];
const BOOK_ICONS = ["📒", "📕", "📗", "📘", "👶", "🏖️", "🏠", "🚗", "💼", "🎓", "🐱", "🌸"];
const ACCOUNT_ICONS = ["💵", "🏦", "💳", "👛", "📱", "🪙", "💰", "🐷", "🛍️", "⭐", "🌸", "🎀"];
const GOAL_ICONS = ["🐷", "🚗", "🏠", "💻", "📱", "✈️", "🎓", "💍", "👶", "🏖️", "🛟", "⭐"];

const DEFAULT_CATEGORIES = {
  expense: [["Food", "🍔"], ["Transport", "🚌"], ["Housing", "🏠"], ["Daily", "🧺"], ["Clothing", "👕"],
    ["Beauty", "💄"], ["Social", "🥂"], ["Entertainment", "🎬"], ["Phone", "📱"], ["Medical", "🏥"],
    ["Tax", "🧾"], ["Gifts", "🎁"], ["Other", "🏷️"]],
  income: [["Salary", "💼"], ["Bonus", "🎉"], ["Side job", "🛠️"], ["Investment", "📈"], ["Other income", "💰"]],
};

const app = document.querySelector("#app");
const editorRoot = document.querySelector("#editor");
const sheetRoot = document.querySelector("#sheet");
const searchRoot = document.querySelector("#search");
const panelRoot = document.querySelector("#panel");
const SEARCH_LIMIT = 100;

const now = new Date();
const state = {
  user: null,
  data: null,
  tab: "books",
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  booksView: "list",
  calendarMode: "total",
  day: null,
  chartMode: "expense",
  pick: null,
  loginMode: "login",
  loginMessage: "",
  ...readSettings(),
};

let entry = null; // the entry being added or edited
let sheet = null; // data for the open book or account form
let search = null; // the open search screen: { text, kind }
let budgetOpen = false; // whether the Budget screen is showing
let busy = false;
let toastTimer;
let confirmAnswer = null;

function readSettings() {
  const fallback = { lang: navigator.language.startsWith("en") ? "en" : "th", bookId: null };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
  } catch {
    return fallback;
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ lang: state.lang, bookId: state.bookId }));
}

function t(key, values = {}) {
  const text = LANG[state.lang][key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => values[name]);
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function newId() {
  return crypto.randomUUID();
}

function money(satang, withSign = false) {
  const value = Math.abs(satang) / 100;
  const decimals = satang % 100 === 0 ? 0 : 2;
  const text = value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: 2 });
  const sign = satang < 0 ? "-" : withSign && satang > 0 ? "+" : "";
  return `${sign}฿${text}`;
}

function localDate(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseDate(text) {
  const [year, month, day] = text.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function locale() {
  return state.lang === "th" ? "th-TH" : "en-GB";
}

function dateLabel(text) {
  return parseDate(text).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" });
}

function categoryName(category) {
  return LANG[state.lang].cats[category.name] ?? category.name;
}

function toast(message) {
  const box = document.querySelector("#toast");
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), 2600);
}

/* ---------- Data ---------- */

function find(table, id) {
  return state.data[table].find((row) => row.id === id);
}

function putLocal(table, row) {
  const rows = state.data[table];
  const index = rows.findIndex((item) => item.id === row.id);
  if (index >= 0) rows[index] = row;
  else rows.push(row);
}

async function saveRow(table, row) {
  await store.save(table, row);
  putLocal(table, row);
}

async function removeRow(table, id) {
  await store.remove(table, id);
  state.data[table] = state.data[table].filter((row) => row.id !== id);
  if (table === "books") {
    state.data.transactions = state.data.transactions.filter((row) => row.book_id !== id);
    state.data.budgets = state.data.budgets.filter((row) => row.book_id !== id);
  }
}

async function seedIfEmpty() {
  const { data } = state;
  if (data.books.length) return;
  const stamp = new Date().toISOString();
  const book = { id: newId(), name: t("defaultBook"), icon: "📒", created_at: stamp };
  const accounts = [
    { id: newId(), name: t("defaultCash"), kind: "cash", icon: "💵", opening_balance: 0, created_at: stamp },
    { id: newId(), name: t("defaultBank"), kind: "bank", icon: "🏦", opening_balance: 0, created_at: stamp },
  ];
  const categories = [];
  Object.entries(DEFAULT_CATEGORIES).forEach(([kind, list]) => {
    list.forEach(([name, icon], sort) => categories.push({ id: newId(), name, kind, icon, sort }));
  });
  await store.save("books", book);
  await store.save("accounts", accounts);
  await store.save("categories", categories);
  data.books.push(book);
  data.accounts.push(...accounts);
  data.categories.push(...categories);
}

function currentBook() {
  const { books } = state.data;
  return books.find((book) => book.id === state.bookId) ?? books[0];
}

function balances() {
  const totals = new Map(state.data.accounts.map((account) => [account.id, account.opening_balance]));
  const add = (id, amount) => totals.set(id, (totals.get(id) ?? 0) + amount);
  state.data.transactions.forEach((row) => {
    if (row.kind === "income") add(row.account_id, row.amount);
    else add(row.account_id, -row.amount);
    if (row.kind === "transfer") add(row.to_account_id, row.amount);
  });
  return totals;
}

function sortedBooks() {
  return [...state.data.books].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function sortedAccounts() {
  return [...state.data.accounts].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function monthPrefix() {
  return `${state.year}-${String(state.month).padStart(2, "0")}`;
}

function monthEntries() {
  const prefix = monthPrefix();
  const bookId = currentBook().id;
  return state.data.transactions
    .filter((row) => row.book_id === bookId && row.occurred_on.startsWith(prefix))
    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at));
}

/* ---------- Main screens ---------- */

function render() {
  document.documentElement.lang = state.lang;
  if (store.needsLogin && !state.user) return renderLogin();
  if (!state.data) {
    app.innerHTML = `<div class="loading">…</div>`;
    return;
  }
  const page = { books: renderBooks, wallet: renderWallet, charts: renderCharts, more: renderMore }[state.tab]();
  const tabs = [["books", "📒"], ["wallet", "👛"], ["charts", "📊"], ["more", "🌸"]].map(([tab, icon]) => `
    <button data-act="tab" data-tab="${tab}" class="${state.tab === tab ? "on" : ""}" ${state.tab === tab ? 'aria-current="page"' : ""}>
      <span aria-hidden="true">${icon}</span>${t(tab)}
    </button>`).join("");
  app.innerHTML = `${page}<nav class="tabs">${tabs}</nav>`;
  if (state.tab === "charts") bindTrend();
  if (search) renderSearchResults();
  if (budgetOpen) renderBudgetPanel();
}

function monthNav() {
  const monthName = new Date(state.year, state.month - 1, 1).toLocaleDateString(locale(), { month: "long", year: "numeric" });
  return `
    <div class="month-nav">
      <button class="icon-btn" data-act="month" data-step="-1" aria-label="${t("prevMonth")}">‹</button>
      <strong>${esc(monthName)}</strong>
      <button class="icon-btn" data-act="month" data-step="1" aria-label="${t("nextMonth")}">›</button>
    </div>`;
}

function renderLogin() {
  const signup = state.loginMode === "signup";
  app.innerHTML = `
    <div class="login">
      <form class="login-card card" data-form="login">
        <div class="emoji" aria-hidden="true">🌸</div>
        <h1>${t("appName")}</h1>
        <label class="field"><span>${t("email")}</span>
          <input type="email" name="email" autocomplete="username" required></label>
        <label class="field"><span>${t("password")}</span>
          <input type="password" name="password" minlength="8" required placeholder="${signup ? t("passwordHint") : ""}"
            autocomplete="${signup ? "new-password" : "current-password"}"></label>
        <button class="primary" type="submit">${t(signup ? "signup" : "login")}</button>
        ${state.loginMessage ? `<p class="form-msg" role="alert">${esc(state.loginMessage)}</p>` : ""}
        <button class="link-btn" type="button" data-act="login-mode">${t(signup ? "toLogin" : "toSignup")}</button>
      </form>
    </div>`;
}

function renderBooks() {
  const book = currentBook();
  const rows = monthEntries();
  const expense = rows.filter((row) => row.kind === "expense").reduce((sum, row) => sum + row.amount, 0);
  const income = rows.filter((row) => row.kind === "income").reduce((sum, row) => sum + row.amount, 0);
  const net = income - expense;
  const calendar = state.booksView === "calendar";

  const chips = sortedBooks().map((item) => `
    <button class="book-chip ${item.id === book.id ? "on" : ""}" data-act="book" data-id="${item.id}" ${item.id === book.id ? 'aria-current="true"' : ""}>
      <span class="emoji" aria-hidden="true">${esc(item.icon)}</span><span class="label">${esc(item.name)}</span>
    </button>`).join("");

  return `
    <header class="hero">
      <div class="hero-title">
        <h1>${esc(book.name)}</h1>
        <div class="hero-actions">
          <button class="hero-btn" data-act="open-search" aria-label="${t("search")}">🔍</button>
          <button class="hero-btn" data-act="books-view" aria-label="${t(calendar ? "listView" : "calendarView")}">${calendar ? "📋" : "📅"}</button>
          <button class="ghost-btn" data-act="edit-book">${t("edit")}</button>
        </div>
      </div>
      <div class="book-row">
        ${chips}
        <button class="book-chip" data-act="new-book">
          <span class="emoji" aria-hidden="true">＋</span><span class="label">${t("addBook")}</span>
        </button>
      </div>
    </header>
    <main class="body">
      ${calendar ? renderCalendar(rows) : `
        <section class="summary card">
          ${monthNav()}
          <span class="summary-tag">${t(net < 0 ? "overspent" : "saved")}</span>
          <div class="summary-net ${net < 0 ? "neg" : "pos"}">${money(net)}</div>
          <div class="summary-split">
            <span>${t("expense")} <b class="neg">${money(expense)}</b></span>
            <span>${t("income")} <b class="pos">${money(income)}</b></span>
          </div>
        </section>
        ${renderBudgetCard()}
        ${renderGoals()}
        ${rows.length ? renderDays(rows) : `
          <section class="empty card">
            <div class="emoji" aria-hidden="true">📒</div>
            <strong>${t("noEntries")}</strong>${t("noEntriesHint")}
          </section>`}`}
    </main>
    <button class="fab" data-act="new-entry" aria-label="${t("expense")}">✏️</button>`;
}

function selectedDay() {
  const prefix = monthPrefix();
  if (state.day && state.day.startsWith(prefix)) return state.day;
  const today = localDate();
  return today.startsWith(prefix) ? today : `${prefix}-01`;
}

function renderCalendar(rows) {
  const prefix = monthPrefix();
  const today = localDate();
  const chosen = selectedDay();
  const totals = new Map();
  rows.forEach((row) => {
    if (row.kind === "transfer") return;
    const day = totals.get(row.occurred_on) ?? { income: 0, expense: 0 };
    day[row.kind] += row.amount;
    totals.set(row.occurred_on, day);
  });
  const shown = (day) => ({
    expense: -day.expense,
    income: day.income,
    total: day.income - day.expense,
  })[state.calendarMode];

  const heads = [...Array(7)].map((_, i) => {
    const name = new Date(2023, 0, 1 + i).toLocaleDateString(locale(), { weekday: "short" }); // 1 Jan 2023 was a Sunday
    return `<div class="cal-head">${esc(name)}</div>`;
  }).join("");
  const blanks = "<span></span>".repeat(new Date(state.year, state.month - 1, 1).getDay());
  const count = new Date(state.year, state.month, 0).getDate();
  const days = [...Array(count)].map((_, i) => {
    const date = `${prefix}-${String(i + 1).padStart(2, "0")}`;
    const value = totals.has(date) ? shown(totals.get(date)) : 0;
    const label = value ? `${value > 0 ? "+" : ""}${compact(value)}` : "";
    return `
      <button class="cal-day ${date === chosen ? "on" : ""} ${date === today ? "today" : ""}" data-act="cal-day" data-day="${date}"
        aria-pressed="${date === chosen}" aria-label="${esc(dateLabel(date))}${value ? ` ${money(value)}` : ""}">
        ${i + 1}<b class="${value < 0 ? "neg" : "pos"}">${label}</b>
      </button>`;
  }).join("");
  const modes = ["expense", "income", "total"].map((mode) => `
    <button data-act="calendar-mode" data-mode="${mode}" class="${state.calendarMode === mode ? "on" : ""}">${t(mode)}</button>`).join("");

  const day = totals.get(chosen) ?? { income: 0, expense: 0 };
  const dayRows = rows.filter((row) => row.occurred_on === chosen);
  return `
    <section class="calendar card">
      ${monthNav()}
      <div class="cal-grid">${heads}${blanks}${days}</div>
      <div class="seg cal-seg">${modes}</div>
      <div class="cal-stats">
        <div><b>${money(day.income - day.expense)}</b>${t("total")}</div>
        <div><b class="pos">${money(day.income)}</b>${t("income")}</div>
        <div><b class="neg">${money(day.expense)}</b>${t("expense")}</div>
      </div>
    </section>
    ${dayRows.length ? renderDays(dayRows) : `<section class="empty card"><strong>${t("dayEmpty")}</strong>${esc(dateLabel(chosen))}</section>`}`;
}

function renderDays(rows, showBook = false) {
  const days = new Map();
  rows.forEach((row) => {
    if (!days.has(row.occurred_on)) days.set(row.occurred_on, []);
    days.get(row.occurred_on).push(row);
  });
  return [...days].map(([day, list]) => {
    const spent = list.filter((row) => row.kind === "expense").reduce((sum, row) => sum + row.amount, 0);
    return `
      <section class="day card">
        <div class="day-head"><span>${esc(dateLabel(day))}</span>${spent ? `<span>${t("expense")} ${money(spent)}</span>` : ""}</div>
        ${list.map((row) => renderEntry(row, showBook)).join("")}
      </section>`;
  }).join("");
}

function renderEntry(row, showBook) {
  const account = find("accounts", row.account_id);
  const book = showBook ? `${find("books", row.book_id).name} · ` : "";
  if (row.kind === "transfer") {
    const target = find("accounts", row.to_account_id);
    return entryButton(row, "🔁", t("transfer"), `${book}${account.name} → ${target.name}`, money(row.amount), "");
  }
  const category = find("categories", row.category_id);
  const positive = row.kind === "income";
  const sub = `${book}${account.name}${row.note ? ` · ${row.note}` : ""}`;
  return entryButton(row, category.icon, categoryName(category), sub, money(positive ? row.amount : -row.amount, true), positive ? "pos" : "neg");
}

function entryButton(row, icon, title, sub, amount, tone) {
  return `
    <button class="entry" data-act="edit-entry" data-id="${row.id}">
      <span class="bubble" aria-hidden="true">${esc(icon)}</span>
      <span class="entry-main"><div>${esc(title)}</div><div class="entry-sub">${esc(sub)}</div></span>
      <span class="entry-amount ${tone}">${amount}</span>
    </button>`;
}

function renderWallet() {
  const totals = balances();
  const accounts = sortedAccounts();
  const amounts = accounts.map((account) => totals.get(account.id));
  const assets = amounts.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const debt = -amounts.filter((value) => value < 0).reduce((sum, value) => sum + value, 0);

  const groups = KIND_ORDER.map((kind) => {
    const list = accounts.filter((account) => account.kind === kind);
    if (!list.length) return "";
    const total = list.reduce((sum, account) => sum + totals.get(account.id), 0);
    return `
      <section class="group card">
        <div class="group-head"><span>${t(`kind_${kind}`)}</span><span>${money(total)}</span></div>
        ${list.map((account) => `
          <button class="entry" data-act="edit-account" data-id="${account.id}">
            <span class="bubble" aria-hidden="true">${esc(account.icon)}</span>
            <span class="entry-main"><div>${esc(account.name)}</div></span>
            <span class="entry-amount ${totals.get(account.id) < 0 ? "neg" : ""}">${money(totals.get(account.id))}</span>
          </button>`).join("")}
      </section>`;
  }).join("");

  return `
    <header class="hero">
      <h1>${t("wallet")}</h1>
      <div class="hero-label">${t("netWorth")}</div>
      <div class="hero-net">${money(assets - debt)}</div>
      <div class="hero-split">
        <div><small>${t("assets")}</small>${money(assets)}</div>
        <div><small>${t("debt")}</small>${money(debt)}</div>
      </div>
    </header>
    <main class="body">
      ${groups}
      <button class="add-line" data-act="new-account">＋ ${t("addAccount")}</button>
    </main>`;
}

function renderMore() {
  const langButton = (code, label) => `<button data-act="lang" data-lang="${code}" class="${state.lang === code ? "on" : ""}">${label}</button>`;
  return `
    <header class="hero"><h1>${t("more")}</h1></header>
    <main class="body">
      <section class="card">
        <div class="row"><span>${t("language")}</span><div class="seg">${langButton("th", "ไทย")}${langButton("en", "EN")}</div></div>
        ${state.user ? `
          <div class="row"><span>${t("signedInAs")}<small>${esc(state.user.email)}</small></span></div>
          <div class="row"><button class="text-btn" data-act="sign-out">${t("signOut")}</button></div>`
        : `<div class="row"><span>${t("practice")}<small>${t("practiceHint")}</small></span></div>`}
      </section>
    </main>`;
}

/* ---------- Budgets and goals ---------- */

function budgetFor(categoryId) {
  const bookId = currentBook().id;
  return state.data.budgets.find((row) => row.book_id === bookId && (row.category_id ?? null) === categoryId);
}

function monthSpent(categoryId) {
  return monthEntries()
    .filter((row) => row.kind === "expense" && (!categoryId || row.category_id === categoryId))
    .reduce((sum, row) => sum + row.amount, 0);
}

function budgetBar(spent, limit) {
  const share = Math.min(100, (spent / limit) * 100);
  return `<div class="bar ${spent > limit ? "over" : ""}"><i style="width:${share}%"></i></div>`;
}

function budgetLeft(spent, limit) {
  return spent > limit
    ? `<b class="neg">${t("overBy", { amount: money(spent - limit) })}</b>`
    : `<b>${t("amountLeft", { amount: money(limit - spent) })}</b>`;
}

function renderBudgetCard() {
  const budget = budgetFor(null);
  if (!budget) return `<button class="add-line budget-add" data-act="open-budget">＋ ${t("setBudget")}</button>`;
  const spent = monthSpent(null);
  const today = new Date();
  const isThisMonth = localDate(today).startsWith(monthPrefix());
  const days = new Date(state.year, state.month, 0).getDate() - today.getDate() + 1;
  const pace = isThisMonth && spent < budget.amount
    ? `<span>${t("daysLeft", { days })} · ${t("perDay", { amount: money(Math.floor((budget.amount - spent) / days)) })}</span>`
    : "";
  return `
    <button class="budget-card card" data-act="open-budget">
      <div class="budget-head"><span>🎯 ${t("monthlyBudget")}</span><span>${percent(spent, budget.amount)}</span></div>
      ${budgetBar(spent, budget.amount)}
      <div class="budget-note"><span>${budgetLeft(spent, budget.amount)}</span>${pace}</div>
    </button>`;
}

function budgetLine(categoryId, icon, name) {
  const budget = budgetFor(categoryId);
  const spent = monthSpent(categoryId);
  const detail = budget ? `
    ${budgetBar(spent, budget.amount)}
    <div class="budget-note">
      <span>${t("spentOf", { spent: money(spent), limit: money(budget.amount) })}</span>
      <span>${budgetLeft(spent, budget.amount)}</span>
    </div>` : `
    <div class="budget-note"><span>${money(spent)}</span><span class="set-limit">${t("setLimit")}</span></div>`;
  return `
    <button class="budget-row" data-act="edit-budget" data-category="${categoryId ?? ""}">
      <span class="bubble" aria-hidden="true">${esc(icon)}</span>
      <span class="entry-main"><strong>${esc(name)}</strong>${detail}</span>
    </button>`;
}

function renderBudgetPanel() {
  const scroller = panelRoot.querySelector(".search-results");
  const scrollTop = scroller ? scroller.scrollTop : 0;
  const share = (category) => {
    const budget = budgetFor(category.id);
    return budget ? monthSpent(category.id) / budget.amount : -1;
  };
  const categories = categoriesOf("expense").sort((a, b) => share(b) - share(a) || monthSpent(b.id) - monthSpent(a.id));
  panelRoot.innerHTML = `
    <div class="search" role="dialog" aria-modal="true" aria-label="${t("budget")}">
      <div class="search-top">
        <button class="icon-btn" data-act="close-budget" aria-label="${t("close")}">✕</button>
        <strong>${t("budget")} · ${esc(currentBook().name)}</strong>
      </div>
      <div class="search-results">
        <section class="card panel-month">${monthNav()}</section>
        <section class="card panel-card">${budgetLine(null, "🎯", t("allSpending"))}</section>
        <section class="card panel-card">
          ${categories.map((category) => budgetLine(category.id, category.icon, categoryName(category))).join("")}
        </section>
      </div>
    </div>`;
  panelRoot.querySelector(".search-results").scrollTop = scrollTop;
}

function renderGoals() {
  const cards = [...state.data.goals].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((goal) => `
    <button class="goal" data-act="edit-goal" data-id="${goal.id}">
      <span class="emoji" aria-hidden="true">${esc(goal.icon)}</span>
      <strong>${esc(goal.name)}</strong>
      ${goalBar(goal)}
      <small>${goal.saved >= goal.target ? `🎉 ${t("goalDone")}` : percent(goal.saved, goal.target)}</small>
      <small>${t("spentOf", { spent: compact(goal.saved), limit: compact(goal.target) })}</small>
    </button>`).join("");
  return `
    <div class="goal-row" role="group" aria-label="${t("goals")}">
      ${cards}
      <button class="goal add" data-act="new-goal"><span aria-hidden="true">＋</span>${t("addGoal")}</button>
    </div>`;
}

function goalBar(goal) {
  return `<div class="bar"><i style="width:${Math.min(100, (goal.saved / goal.target) * 100)}%"></i></div>`;
}

/* ---------- Search ---------- */

function openSearch() {
  search = { text: "", kind: "all" };
  const kinds = ["all", "expense", "income", "transfer"].map((kind) => `
    <button data-act="search-kind" data-kind="${kind}">${t(kind)}</button>`).join("");
  searchRoot.innerHTML = `
    <div class="search" role="dialog" aria-modal="true" aria-label="${t("search")}">
      <div class="search-top">
        <button class="icon-btn" data-act="close-search" aria-label="${t("close")}">✕</button>
        <input type="search" id="search-text" enterkeyhint="search" placeholder="${t("searchHint")}" aria-label="${t("search")}">
      </div>
      <div class="search-kinds">${kinds}</div>
      <div class="search-results" id="search-results"></div>
    </div>`;
  renderSearchResults();
  document.querySelector("#search-text").focus();
}

function searchText(row) {
  const account = find("accounts", row.account_id);
  const target = row.to_account_id ? find("accounts", row.to_account_id) : null;
  const category = row.category_id ? find("categories", row.category_id) : null;
  return [
    row.note, account.name, target?.name, find("books", row.book_id).name, String(row.amount / 100),
    category?.name, category ? LANG.th.cats[category.name] : null,
  ].filter(Boolean).join(" ").toLowerCase();
}

function renderSearchResults() {
  const words = search.text.toLowerCase().replace(/,/g, "").split(/\s+/).filter(Boolean);
  const matches = state.data.transactions
    .filter((row) => search.kind === "all" || row.kind === search.kind)
    .filter((row) => {
      const text = searchText(row);
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at));

  searchRoot.querySelectorAll("[data-act=search-kind]").forEach((button) => {
    button.classList.toggle("on", button.dataset.kind === search.kind);
  });
  const note = matches.length > SEARCH_LIMIT
    ? t("resultLimit", { shown: SEARCH_LIMIT, count: matches.length })
    : t("resultCount", { count: matches.length });
  document.querySelector("#search-results").innerHTML = matches.length
    ? `<p class="search-note">${note}</p>${renderDays(matches.slice(0, SEARCH_LIMIT), true)}`
    : `<section class="empty card"><div class="emoji" aria-hidden="true">🔍</div><strong>${t("noResults")}</strong></section>`;
}

/* ---------- Adding and editing an entry ---------- */

function latestAccountId() {
  const latest = state.data.transactions.reduce((best, row) => (!best || row.created_at > best.created_at ? row : best), null);
  return latest ? latest.account_id : sortedAccounts()[0].id;
}

function firstCategoryId(kind) {
  return categoriesOf(kind)[0].id;
}

function categoriesOf(kind) {
  return state.data.categories.filter((row) => row.kind === kind).sort((a, b) => a.sort - b.sort);
}

function openNewEntry() {
  const accountId = latestAccountId();
  const other = sortedAccounts().find((account) => account.id !== accountId);
  entry = {
    id: null, kind: "expense", categoryId: firstCategoryId("expense"), accountId,
    toAccountId: other ? other.id : null, note: "", expr: "",
    date: state.booksView === "calendar" ? selectedDay() : localDate(),
  };
  renderEditor();
}

function openEntry(id) {
  const row = find("transactions", id);
  const other = sortedAccounts().find((account) => account.id !== row.account_id);
  entry = {
    id, kind: row.kind, categoryId: row.category_id ?? firstCategoryId("expense"), accountId: row.account_id,
    toAccountId: row.to_account_id ?? (other ? other.id : null), date: row.occurred_on, note: row.note,
    expr: String(row.amount / 100), createdAt: row.created_at,
  };
  renderEditor();
}

function renderEditor() {
  if (!entry) {
    editorRoot.innerHTML = "";
    return;
  }
  const tabs = ["expense", "income", "transfer"].map((kind) => `
    <button data-act="entry-kind" data-kind="${kind}" class="${entry.kind === kind ? "on" : ""}">${t(kind)}</button>`).join("");
  const account = find("accounts", entry.accountId);
  const dateText = entry.date === localDate() ? t("today") : dateLabel(entry.date);
  const digit = (value) => `<button class="key" data-act="key" data-key="${value}">${value}</button>`;
  const op = (value) => `<button class="key op" data-act="key" data-key="${value}">${value}</button>`;

  editorRoot.innerHTML = `
    <div class="editor" role="dialog" aria-modal="true" aria-label="${t(entry.kind)}">
      <div class="editor-top">
        <button class="icon-btn" data-act="close-entry" aria-label="${t("close")}">✕</button>
        <div class="kind-tabs">${tabs}</div>
        <button class="icon-btn" data-act="save-entry" aria-label="${t("done")}">✓</button>
      </div>
      <div class="editor-body">
        ${entry.kind === "transfer" ? renderTransferPick() : renderCategoryGrid()}
        ${entry.id ? `<button class="delete-link" data-act="delete-entry">${t("delete")}</button>` : ""}
      </div>
      <div class="keypad">
        ${entry.kind === "transfer" ? "" : `<button class="key util key-account" data-act="pick-account" data-field="accountId" aria-label="${esc(account.name)}">${esc(account.icon)}</button>`}
        <div class="display" ${entry.kind === "transfer" ? 'style="grid-column: span 4"' : ""}>
          <input id="entry-note" data-entry-note maxlength="200" placeholder="${t("note")}" aria-label="${t("note")}" value="${esc(entry.note)}">
          <div class="display-amount" id="entry-amount"></div>
        </div>
        <label class="key util span2">${esc(dateText)}
          <input type="date" data-entry-date aria-label="${esc(dateText)}" value="${entry.date}"></label>
        <button class="key util" data-act="save-entry" data-next="1" ${entry.id ? "disabled" : ""}>${entry.id ? "" : t("saveNext")}</button>
        <button class="key go" data-act="save-entry" aria-label="${t("done")}">✓</button>
        ${op("×")}${digit(7)}${digit(8)}${digit(9)}
        ${op("÷")}${digit(4)}${digit(5)}${digit(6)}
        ${op("-")}${digit(1)}${digit(2)}${digit(3)}
        ${op("+")}${digit(".")}${digit(0)}
        <button class="key op" data-act="key" data-key="back" aria-label="${t("backspace")}">⌫</button>
      </div>
    </div>`;
  updateDisplay();
}

function renderCategoryGrid() {
  return `<div class="cat-grid">${categoriesOf(entry.kind).map((category) => `
    <button class="cat ${category.id === entry.categoryId ? "on" : ""}" data-act="entry-category" data-id="${category.id}"
      aria-pressed="${category.id === entry.categoryId}">
      <span aria-hidden="true">${esc(category.icon)}</span>${esc(categoryName(category))}
    </button>`).join("")}</div>`;
}

function renderTransferPick() {
  const line = (field, label) => {
    const account = find("accounts", entry[field]);
    return `
      <button data-act="pick-account" data-field="${field}">
        <span class="bubble" aria-hidden="true">${account ? esc(account.icon) : "＋"}</span>
        <span><small>${label}</small>${account ? esc(account.name) : t("needTwoAccounts")}</span>
      </button>`;
  };
  return `<div class="transfer-pick">${line("accountId", t("from"))}${line("toAccountId", t("to"))}</div>`;
}

function updateDisplay() {
  const box = document.querySelector("#entry-amount");
  if (!box) return;
  const hasOp = /[+\-×÷]/.test(entry.expr);
  const total = evaluate(entry.expr);
  const result = hasOp && total !== null ? `<small><bdi>= ${money(toSatang(total))}</bdi></small>` : "";
  box.innerHTML = `<bdi>${esc(entry.expr || "0")}</bdi>${result}`;
}

function pressKey(key) {
  const expr = entry.expr;
  const current = expr.split(/[+\-×÷]/).pop();
  if (key === "back") {
    entry.expr = expr.slice(0, -1);
  } else if (/[+\-×÷]/.test(key)) {
    if (!expr) return;
    entry.expr = /[+\-×÷]$/.test(expr) ? expr.slice(0, -1) + key : expr + key;
  } else if (expr.length >= 24) {
    return;
  } else if (key === ".") {
    if (current.includes(".")) return;
    entry.expr = expr + (current ? "." : "0.");
  } else {
    if (/\.\d\d$/.test(current)) return;
    entry.expr = current === "0" ? expr.slice(0, -1) + key : expr + key;
  }
  updateDisplay();
}

// Works out the keypad sum with × and ÷ first. Returns null if it can't be worked out.
function evaluate(expr) {
  const clean = expr.replace(/[+\-×÷]$/, "");
  if (!clean) return null;
  const parts = clean.match(/\d+\.?\d*|\.\d+|[+\-×÷]/g);
  const terms = [Number(parts[0])];
  const signs = [];
  for (let i = 1; i < parts.length; i += 2) {
    const sign = parts[i];
    const value = Number(parts[i + 1]);
    if (sign === "×") terms[terms.length - 1] *= value;
    else if (sign === "÷") {
      if (value === 0) return null;
      terms[terms.length - 1] /= value;
    } else {
      signs.push(sign);
      terms.push(value);
    }
  }
  return terms.slice(1).reduce((sum, value, i) => (signs[i] === "+" ? sum + value : sum - value), terms[0]);
}

function toSatang(value) {
  return Math.round(value * 100);
}

async function saveEntry(next) {
  if (busy) return;
  const total = evaluate(entry.expr);
  const amount = total === null ? 0 : toSatang(total);
  if (!entry.expr) return toast(t("needAmount"));
  if (amount <= 0 || amount > MAX_AMOUNT) return toast(t("badAmount"));
  const transfer = entry.kind === "transfer";
  if (transfer && !entry.toAccountId) return toast(t("needTwoAccounts"));
  if (transfer && entry.toAccountId === entry.accountId) return toast(t("sameAccount"));

  const row = {
    id: entry.id ?? newId(),
    book_id: entry.id ? find("transactions", entry.id).book_id : currentBook().id,
    kind: entry.kind,
    amount,
    account_id: entry.accountId,
    to_account_id: transfer ? entry.toAccountId : null,
    category_id: transfer ? null : entry.categoryId,
    note: entry.note.trim(),
    occurred_on: entry.date,
    created_at: entry.createdAt ?? new Date().toISOString(),
  };
  busy = true;
  try {
    await saveRow("transactions", row);
    toast(t("savedToast"));
    if (next) {
      entry.expr = "";
      entry.note = "";
      renderEditor();
    } else {
      entry = null;
      renderEditor();
      showEntryMonth(row.occurred_on);
    }
    render();
  } catch {
    toast(t("saveFailed"));
  } finally {
    busy = false;
  }
}

function showEntryMonth(date) {
  const [year, month] = date.split("-").map(Number);
  state.year = year;
  state.month = month;
  state.day = date;
}

/* ---------- Sheets ---------- */

function openPicker(field) {
  const totals = balances();
  sheet = { type: "picker", field };
  sheetRoot.innerHTML = `
    <div class="backdrop" data-act="close-sheet">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${t("pickAccount")}">
        <h2>${t("pickAccount")}</h2>
        ${sortedAccounts().map((account) => `
          <button class="pick" data-act="choose-account" data-id="${account.id}">
            <span class="bubble" aria-hidden="true">${esc(account.icon)}</span>
            <span class="entry-main">${esc(account.name)}</span>
            <span>${money(totals.get(account.id))}</span>
          </button>`).join("")}
      </div>
    </div>`;
}

function openBookForm(id) {
  const book = id ? find("books", id) : null;
  sheet = { type: "books", id, icon: book ? book.icon : BOOK_ICONS[0], name: book ? book.name : "" };
  renderForm();
}

function openAccountForm(id) {
  const account = id ? find("accounts", id) : null;
  sheet = {
    type: "accounts", id, icon: account ? account.icon : ACCOUNT_ICONS[0], name: account ? account.name : "",
    kind: account ? account.kind : "cash",
  };
  renderForm();
}

function renderForm() {
  const isBook = sheet.type === "books";
  const title = t(isBook ? (sheet.id ? "editBook" : "newBook") : sheet.id ? "editAccount" : "newAccount");
  const icons = (isBook ? BOOK_ICONS : ACCOUNT_ICONS).map((icon) => `
    <button type="button" class="${icon === sheet.icon ? "on" : ""}" data-act="form-icon" data-icon="${icon}" aria-pressed="${icon === sheet.icon}">${icon}</button>`).join("");
  const accountFields = isBook ? "" : `
    <label class="field"><span>${t("type")}</span>
      <select name="kind" data-form-kind>
        ${KIND_ORDER.map((kind) => `<option value="${kind}" ${kind === sheet.kind ? "selected" : ""}>${t(`kind_${kind}`)}</option>`).join("")}
      </select></label>
    ${sheet.id ? "" : `<label class="field"><span id="balance-label">${t(sheet.kind === "credit" ? "owedNow" : "balanceNow")}</span>
      <input name="balance" inputmode="decimal" autocomplete="off" placeholder="0"></label>`}`;

  sheetRoot.innerHTML = `
    <div class="backdrop" data-act="close-sheet">
      <form class="sheet" role="dialog" aria-modal="true" aria-label="${title}" data-form="sheet">
        <h2>${title}</h2>
        <label class="field"><span>${t("name")}</span>
          <input name="name" maxlength="60" autocomplete="off" value="${esc(sheet.name)}"></label>
        ${accountFields}
        <div class="field"><span>${t("icon")}</span><div class="icon-grid">${icons}</div></div>
        <button class="primary" type="submit">${t("save")}</button>
        ${sheet.id ? `<button class="danger" type="button" data-act="delete-form">${t("delete")}</button>` : ""}
      </form>
    </div>`;
}

function openBudgetForm(categoryId) {
  const budget = budgetFor(categoryId);
  sheet = { type: "budgets", id: budget ? budget.id : null, categoryId };
  const category = categoryId ? find("categories", categoryId) : null;
  const title = t("budgetFor", { name: category ? categoryName(category) : t("allSpending") });
  sheetRoot.innerHTML = `
    <div class="backdrop" data-act="close-sheet">
      <form class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" data-form="sheet">
        <h2>${esc(title)}</h2>
        <label class="field"><span>${t("perMonth")}</span>
          <input name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${budget ? budget.amount / 100 : ""}"></label>
        <button class="primary" type="submit">${t("save")}</button>
        ${budget ? `<button class="danger" type="button" data-act="delete-form">${t("removeLimit")}</button>` : ""}
      </form>
    </div>`;
}

function openGoalForm(id) {
  const goal = id ? find("goals", id) : null;
  sheet = { type: "goals", id, icon: goal ? goal.icon : GOAL_ICONS[0] };
  const title = t(goal ? "editGoal" : "newGoal");
  const icons = GOAL_ICONS.map((icon) => `
    <button type="button" class="${icon === sheet.icon ? "on" : ""}" data-act="form-icon" data-icon="${icon}" aria-pressed="${icon === sheet.icon}">${icon}</button>`).join("");
  sheetRoot.innerHTML = `
    <div class="backdrop" data-act="close-sheet">
      <form class="sheet" role="dialog" aria-modal="true" aria-label="${title}" data-form="sheet">
        <h2>${title}</h2>
        <label class="field"><span>${t("name")}</span>
          <input name="name" maxlength="60" autocomplete="off" value="${goal ? esc(goal.name) : ""}"></label>
        <label class="field"><span>${t("target")}</span>
          <input name="target" inputmode="decimal" autocomplete="off" placeholder="0" value="${goal ? goal.target / 100 : ""}"></label>
        <label class="field"><span>${t("savedSoFar")}</span>
          <input name="saved" inputmode="decimal" autocomplete="off" placeholder="0" value="${goal ? goal.saved / 100 : ""}"></label>
        ${goal ? `<label class="field"><span>${t("addMoney")}</span>
          <input name="add" inputmode="decimal" autocomplete="off" placeholder="0"></label>` : ""}
        <div class="field"><span>${t("icon")}</span><div class="icon-grid">${icons}</div></div>
        <button class="primary" type="submit">${t("save")}</button>
        ${goal ? `<button class="danger" type="button" data-act="delete-form">${t("delete")}</button>` : ""}
      </form>
    </div>`;
}

function closeSheet() {
  sheet = null;
  sheetRoot.innerHTML = "";
}

function askConfirm(message) {
  return new Promise((resolve) => {
    confirmAnswer = resolve;
    sheetRoot.innerHTML = `
      <div class="backdrop">
        <div class="sheet" role="alertdialog" aria-modal="true" aria-label="${esc(message)}">
          <p class="sheet-msg">${esc(message)}</p>
          <div class="sheet-actions">
            <button data-act="confirm" data-answer="">${t("cancel")}</button>
            <button class="confirm" data-act="confirm" data-answer="1">${t("delete")}</button>
          </div>
        </div>
      </div>`;
  });
}

// Reads a typed amount as satang. Blank is 0. Returns null if it isn't a usable amount.
function parseMoney(text) {
  const clean = text.replace(/,/g, "").trim();
  if (clean && !/^-?\d+(\.\d{1,2})?$/.test(clean)) return null;
  const satang = toSatang(Number(clean));
  return Math.abs(satang) > MAX_AMOUNT ? null : satang;
}

function createdAt(table) {
  return sheet.id ? find(table, sheet.id).created_at : new Date().toISOString();
}

// Each returns the row to save, or null after telling the person what's wrong.
const sheetRows = {
  books(form) {
    const name = form.elements.name.value.trim();
    if (!name) return toast(t("needName"));
    return { id: sheet.id ?? newId(), name, icon: sheet.icon, created_at: createdAt("books") };
  },
  accounts(form) {
    const name = form.elements.name.value.trim();
    if (!name) return toast(t("needName"));
    const kind = form.elements.kind.value;
    let opening = sheet.id ? find("accounts", sheet.id).opening_balance : parseMoney(form.elements.balance.value);
    if (opening === null) return toast(t("badBalance"));
    if (!sheet.id && kind === "credit") opening = -Math.abs(opening);
    return { id: sheet.id ?? newId(), name, kind, icon: sheet.icon, opening_balance: opening, created_at: createdAt("accounts") };
  },
  budgets(form) {
    const amount = parseMoney(form.elements.amount.value);
    if (!amount || amount < 0) return toast(t("needAmount"));
    return {
      id: sheet.id ?? newId(), book_id: currentBook().id, category_id: sheet.categoryId,
      amount, created_at: createdAt("budgets"),
    };
  },
  goals(form) {
    const name = form.elements.name.value.trim();
    if (!name) return toast(t("needName"));
    const target = parseMoney(form.elements.target.value);
    const saved = parseMoney(form.elements.saved.value);
    const added = form.elements.add ? parseMoney(form.elements.add.value) : 0;
    if (!target || target < 0 || saved === null || added === null) return toast(t("badGoal"));
    const total = saved + added;
    if (total < 0 || total > MAX_AMOUNT) return toast(t("badGoal"));
    return { id: sheet.id ?? newId(), name, icon: sheet.icon, target, saved: total, created_at: createdAt("goals") };
  },
};

async function submitSheet(form) {
  if (busy) return;
  const row = sheetRows[sheet.type](form);
  if (!row) return;
  busy = true;
  try {
    await saveRow(sheet.type, row);
    if (sheet.type === "books" && !sheet.id) {
      state.bookId = row.id;
      saveSettings();
    }
    closeSheet();
    render();
  } catch {
    toast(t("saveFailed"));
  } finally {
    busy = false;
  }
}

async function deleteEntry() {
  const id = entry.id;
  if (!(await askConfirm(t("deleteEntry")))) return;
  try {
    await removeRow("transactions", id);
    entry = null;
    renderEditor();
    render();
  } catch {
    toast(t("saveFailed"));
  }
}

async function deleteFromForm() {
  const { type, id } = sheet;
  if (type === "books" && state.data.books.length === 1) return toast(t("lastBook"));
  if (type === "accounts") {
    if (state.data.accounts.length === 1) return toast(t("lastAccount"));
    const used = state.data.transactions.some((row) => row.account_id === id || row.to_account_id === id);
    if (used) return toast(t("accountInUse"));
  }
  const { categoryId } = sheet;
  const reopen = () => ({
    books: () => openBookForm(id),
    accounts: () => openAccountForm(id),
    goals: () => openGoalForm(id),
    budgets: () => openBudgetForm(categoryId),
  })[type]();
  const count = state.data.transactions.filter((row) => row.book_id === id).length;
  const message = {
    books: () => t("deleteBook", { name: find("books", id).name, count }),
    accounts: () => t("deleteAccount"),
    goals: () => t("deleteGoal", { name: find("goals", id).name }),
  }[type];
  if (message && !(await askConfirm(message()))) return reopen();
  try {
    await removeRow(type, id);
    closeSheet();
    render();
  } catch {
    reopen();
    toast(t("saveFailed"));
  }
}

/* ---------- Events ---------- */

const actions = {
  tab: (el) => { state.tab = el.dataset.tab; window.scrollTo(0, 0); render(); },
  book: (el) => { state.bookId = el.dataset.id; saveSettings(); render(); },
  month: (el) => {
    const date = new Date(state.year, state.month - 1 + Number(el.dataset.step), 1);
    state.year = date.getFullYear();
    state.month = date.getMonth() + 1;
    state.pick = null;
    render();
  },
  "books-view": () => { state.booksView = state.booksView === "list" ? "calendar" : "list"; render(); },
  "cal-day": (el) => { state.day = el.dataset.day; render(); },
  "calendar-mode": (el) => { state.calendarMode = el.dataset.mode; render(); },
  "chart-mode": (el) => { state.chartMode = el.dataset.mode; state.pick = null; render(); },
  slice: (el) => { state.pick = state.pick === el.dataset.id ? null : el.dataset.id; render(); },
  "open-budget": () => { budgetOpen = true; renderBudgetPanel(); },
  "close-budget": () => { budgetOpen = false; panelRoot.innerHTML = ""; },
  "edit-budget": (el) => openBudgetForm(el.dataset.category || null),
  "new-goal": () => openGoalForm(null),
  "edit-goal": (el) => openGoalForm(el.dataset.id),
  "open-search": openSearch,
  "close-search": () => { search = null; searchRoot.innerHTML = ""; },
  "search-kind": (el) => { search.kind = el.dataset.kind; renderSearchResults(); },
  lang: (el) => { state.lang = el.dataset.lang; saveSettings(); render(); },
  "login-mode": () => {
    state.loginMode = state.loginMode === "login" ? "signup" : "login";
    state.loginMessage = "";
    render();
  },
  "sign-out": signOut,
  "new-entry": openNewEntry,
  "edit-entry": (el) => openEntry(el.dataset.id),
  "close-entry": () => { entry = null; renderEditor(); },
  "entry-kind": (el) => {
    entry.kind = el.dataset.kind;
    if (entry.kind !== "transfer" && find("categories", entry.categoryId).kind !== entry.kind) {
      entry.categoryId = firstCategoryId(entry.kind);
    }
    renderEditor();
  },
  "entry-category": (el) => { entry.categoryId = el.dataset.id; renderEditor(); },
  "save-entry": (el) => saveEntry(Boolean(el.dataset.next)),
  "delete-entry": deleteEntry,
  key: (el) => pressKey(el.dataset.key),
  "pick-account": (el) => openPicker(el.dataset.field),
  "choose-account": (el) => { entry[sheet.field] = el.dataset.id; closeSheet(); renderEditor(); },
  "new-book": () => openBookForm(null),
  "edit-book": () => openBookForm(currentBook().id),
  "new-account": () => openAccountForm(null),
  "edit-account": (el) => openAccountForm(el.dataset.id),
  "form-icon": (el) => {
    sheet.icon = el.dataset.icon;
    sheetRoot.querySelectorAll(".icon-grid button").forEach((button) => {
      const on = button === el;
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", on);
    });
  },
  "delete-form": deleteFromForm,
  confirm: (el) => {
    const answer = Boolean(el.dataset.answer);
    sheetRoot.innerHTML = "";
    if (confirmAnswer) confirmAnswer(answer);
    confirmAnswer = null;
  },
};

document.addEventListener("click", (event) => {
  // Tapping the dark area around a sheet closes it, tapping inside the sheet doesn't.
  if (event.target.matches(".backdrop") && event.target.dataset.act === "close-sheet") return closeSheet();
  const el = event.target.closest("[data-act]");
  if (el && !el.classList.contains("backdrop") && !el.disabled) actions[el.dataset.act](el);
});

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-entry-note]")) entry.note = event.target.value;
  if (event.target.matches("#search-text")) {
    search.text = event.target.value;
    renderSearchResults();
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-entry-date]") && event.target.value) {
    entry.date = event.target.value;
    renderEditor();
  }
  if (event.target.matches("[data-form-kind]")) {
    sheet.kind = event.target.value;
    const label = document.querySelector("#balance-label");
    if (label) label.textContent = t(sheet.kind === "credit" ? "owedNow" : "balanceNow");
  }
});

// Computers only open the date picker from its small icon, so open it from anywhere on the key.
document.addEventListener("click", (event) => {
  if (!event.target.matches("[data-entry-date]")) return;
  try {
    event.target.showPicker();
  } catch {
    // The phone opens its own picker when the field is tapped.
  }
});

document.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.dataset.form === "sheet") submitSheet(event.target);
  if (event.target.dataset.form === "login") submitLogin(event.target);
});

async function submitLogin(form) {
  if (busy) return;
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  busy = true;
  try {
    if (state.loginMode === "signup") {
      const ready = await store.signUp(email, password);
      if (!ready) {
        state.loginMode = "login";
        state.loginMessage = t("confirmEmail");
        busy = false;
        return render();
      }
    } else {
      await store.signIn(email, password);
    }
    state.loginMessage = "";
    busy = false;
    await enterApp();
  } catch (error) {
    busy = false;
    state.loginMessage = state.loginMode === "signup" ? error.message : t("loginFailed");
    render();
  }
}

async function signOut() {
  await store.signOut();
  state.user = null;
  state.data = null;
  entry = null;
  search = null;
  budgetOpen = false;
  render();
}

async function enterApp() {
  if (store.needsLogin) state.user = await store.currentUser();
  render();
  try {
    state.data = await store.loadAll();
    await seedIfEmpty();
    render();
  } catch {
    app.innerHTML = `<div class="loading">${t("loadFailed")}</div>`;
  }
}

async function start() {
  if (store.needsLogin && !db) {
    app.innerHTML = `<div class="loading">${t("loadFailed")}</div>`;
    return;
  }
  if (store.needsLogin && !(await store.currentUser())) return render();
  enterApp();
}

start();
