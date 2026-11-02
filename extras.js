// The tools under More: CSV backup, custom categories and recurring entries.

const CATEGORY_ICONS = [
  "🍔", "🍜", "🍚", "🍣", "🍕", "🍰", "🧋", "☕", "🍺", "🛒", "🧺", "🧴",
  "🚌", "🚗", "🛵", "⛽", "🚆", "✈️", "🏠", "🛋️", "💡", "💧", "📱", "💻",
  "👕", "👟", "💄", "💇", "🎬", "🎮", "🎧", "📚", "🎓", "🏋️", "⚽", "🥂",
  "🏥", "💊", "🐶", "🐱", "👶", "🎁", "🧾", "🛠️", "💼", "🎉", "📈", "💰", "🏷️",
];
const FREQUENCIES = ["weekly", "monthly", "yearly"];
const MAX_CATCH_UP = 120; // entries one rule can add in one go; the rest follow next time

/* ---------- CSV backup ---------- */

// The quote stops a spreadsheet from running a note that starts like a formula.
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv() {
  const heads = ["date", "book", "type", "category", "amountBaht", "account", "toAccount", "note"].map((key) => t(`csv_${key}`));
  const rows = [...state.data.transactions]
    .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.created_at.localeCompare(b.created_at))
    .map((row) => {
      const category = row.category_id ? find("categories", row.category_id) : null;
      const target = row.to_account_id ? find("accounts", row.to_account_id) : null;
      return [
        row.occurred_on, find("books", row.book_id).name, t(row.kind), category ? categoryName(category) : "",
        (row.amount / 100).toFixed(2), find("accounts", row.account_id).name, target ? target.name : "", row.note,
      ].map(csvCell).join(",");
    });
  return [heads.map(csvCell).join(","), ...rows].join("\r\n");
}

async function exportCsv() {
  // The mark at the start tells Excel the file is UTF-8, so Thai shows correctly.
  const blob = new Blob(["﻿", buildCsv()], { type: "text/csv;charset=utf-8" });
  const name = `my-finance-${localDate()}.csv`;
  const file = new File([blob], name, { type: "text/csv" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/* ---------- Panels ---------- */

function panelShell(title, body) {
  const scroller = panelRoot.querySelector(".search-results");
  const scrollTop = scroller ? scroller.scrollTop : 0;
  panelRoot.innerHTML = `
    <div class="search" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="search-top">
        <button class="icon-btn" data-act="close-panel" aria-label="${t("close")}">✕</button>
        <strong>${esc(title)}</strong>
      </div>
      <div class="search-results">${body}</div>
    </div>`;
  panelRoot.querySelector(".search-results").scrollTop = scrollTop;
}

/* ---------- Categories ---------- */

function renderCategoryPanel() {
  const modes = ["expense", "income"].map((kind) => `
    <button data-act="category-kind" data-kind="${kind}" class="${state.categoryKind === kind ? "on" : ""}">${t(kind)}</button>`).join("");
  const rows = categoriesOf(state.categoryKind).map((category) => `
    <button class="entry" data-act="edit-category" data-id="${category.id}">
      <span class="bubble" aria-hidden="true">${esc(category.icon)}</span>
      <span class="entry-main"><div>${esc(categoryName(category))}</div></span>
      <span class="menu-arrow" aria-hidden="true">›</span>
    </button>`).join("");
  panelShell(t("categories"), `
    <div class="seg panel-seg">${modes}</div>
    <section class="card panel-card">${rows}</section>
    <button class="add-line panel-add" data-act="new-category">＋ ${t("addCategory")}</button>`);
}

function openCategoryForm(id) {
  const category = id ? find("categories", id) : null;
  sheet = { type: "categories", id, kind: category ? category.kind : state.categoryKind, icon: category ? category.icon : CATEGORY_ICONS[0] };
  const title = t(category ? "editCategory" : "newCategory");
  const icons = CATEGORY_ICONS.map((icon) => `
    <button type="button" class="${icon === sheet.icon ? "on" : ""}" data-act="form-icon" data-icon="${icon}" aria-pressed="${icon === sheet.icon}">${icon}</button>`).join("");
  sheetRoot.innerHTML = `
    <div class="backdrop" data-act="close-sheet">
      <form class="sheet" role="dialog" aria-modal="true" aria-label="${title}" data-form="sheet">
        <h2>${title}</h2>
        <label class="field"><span>${t("name")}</span>
          <input name="name" maxlength="60" autocomplete="off" value="${category ? esc(categoryName(category)) : ""}"></label>
        <div class="field"><span>${t("icon")}</span><div class="icon-grid">${icons}</div></div>
        <button class="primary" type="submit">${t("save")}</button>
        ${category ? `<button class="danger" type="button" data-act="delete-form">${t("delete")}</button>` : ""}
      </form>
    </div>`;
}

function categoryRow(form) {
  const typed = form.elements.name.value.trim();
  if (!typed) return toast(t("needName"));
  const old = sheet.id ? find("categories", sheet.id) : null;
  // A default category keeps its English name unless it was really renamed, so it still translates.
  const name = old && typed === categoryName(old) ? old.name : typed;
  const nextSort = Math.max(0, ...categoriesOf(sheet.kind).map((row) => row.sort + 1));
  return { id: sheet.id ?? newId(), name, kind: sheet.kind, icon: sheet.icon, sort: old ? old.sort : nextSort };
}

// Returns the message to show if this category can't be deleted.
function categoryBlock(id) {
  const { kind } = find("categories", id);
  if (categoriesOf(kind).length === 1) return t("lastCategory");
  const used = [...state.data.transactions, ...state.data.recurring].some((row) => row.category_id === id);
  return used ? t("categoryInUse") : null;
}

/* ---------- Recurring ---------- */

function renderRecurringPanel() {
  const rules = [...state.data.recurring].sort((a, b) => a.next_on.localeCompare(b.next_on));
  const rows = rules.map((rule) => {
    const category = rule.category_id ? find("categories", rule.category_id) : null;
    const signed = rule.kind === "expense" ? -rule.amount : rule.amount;
    const sub = `${t(rule.frequency)} · ${t("nextOn")} ${dateLabel(rule.next_on)}`;
    return `
      <button class="entry" data-act="edit-recurring" data-id="${rule.id}">
        <span class="bubble" aria-hidden="true">${esc(category ? category.icon : "🔁")}</span>
        <span class="entry-main"><div>${esc(rule.note || (category ? categoryName(category) : t("transfer")))}</div><div class="entry-sub">${esc(sub)}</div></span>
        <span class="entry-amount ${rule.kind === "transfer" ? "" : signed < 0 ? "neg" : "pos"}">${money(signed, rule.kind === "income")}</span>
      </button>`;
  }).join("");
  panelShell(t("recurring"), `
    ${rules.length ? `<section class="card panel-card">${rows}</section>` : `
      <section class="empty card"><div class="emoji" aria-hidden="true">🔁</div><strong>${t("noRecurring")}</strong>${t("noRecurringHint")}</section>`}
    <button class="add-line panel-add" data-act="new-recurring">＋ ${t("addRecurring")}</button>`);
}

function openRecurringForm(id) {
  const rule = id ? find("recurring", id) : null;
  const accounts = sortedAccounts();
  sheet = {
    type: "recurring", id,
    draft: rule ? {
      kind: rule.kind, amount: String(rule.amount / 100), category: rule.category_id ?? "", account: rule.account_id,
      to: rule.to_account_id ?? "", frequency: rule.frequency, date: rule.next_on, note: rule.note,
    } : {
      kind: "expense", amount: "", category: "", account: accounts[0].id,
      to: accounts[1] ? accounts[1].id : "", frequency: "monthly", date: localDate(), note: "",
    },
  };
  renderRecurringForm();
}

function renderRecurringForm() {
  const { draft, id } = sheet;
  const options = (rows, chosen, label) => rows.map((row) => `
    <option value="${esc(row.value)}" ${row.value === chosen ? "selected" : ""}>${esc(label(row))}</option>`).join("");
  const transfer = draft.kind === "transfer";
  const accounts = sortedAccounts().map((row) => ({ value: row.id, name: row.name }));
  const categories = transfer ? [] : categoriesOf(draft.kind).map((row) => ({ value: row.id, name: `${row.icon} ${categoryName(row)}` }));
  const title = t(id ? "editRecurring" : "newRecurring");
  const named = (row) => row.name;
  sheetRoot.innerHTML = `
    <div class="backdrop" data-act="close-sheet">
      <form class="sheet" role="dialog" aria-modal="true" aria-label="${title}" data-form="sheet">
        <h2>${title}</h2>
        <label class="field"><span>${t("type")}</span>
          <select name="kind" data-recurring-kind>${options(["expense", "income", "transfer"].map((value) => ({ value })), draft.kind, (row) => t(row.value))}</select></label>
        <label class="field"><span>${t("amountLabel")}</span>
          <input name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(draft.amount)}"></label>
        ${transfer ? "" : `<label class="field"><span>${t("category")}</span>
          <select name="category">${options(categories, draft.category, named)}</select></label>`}
        <label class="field"><span>${t(transfer ? "from" : "account")}</span>
          <select name="account">${options(accounts, draft.account, named)}</select></label>
        ${transfer ? `<label class="field"><span>${t("to")}</span>
          <select name="to">${options(accounts, draft.to, named)}</select></label>` : ""}
        <label class="field"><span>${t("repeats")}</span>
          <select name="frequency">${options(FREQUENCIES.map((value) => ({ value })), draft.frequency, (row) => t(row.value))}</select></label>
        <label class="field"><span>${t(id ? "nextOn" : "startOn")}</span>
          <input type="date" name="date" value="${esc(draft.date)}"></label>
        <label class="field"><span>${t("note")}</span>
          <input name="note" maxlength="200" autocomplete="off" value="${esc(draft.note)}"></label>
        <button class="primary" type="submit">${t("save")}</button>
        ${id ? `<button class="danger" type="button" data-act="delete-form">${t("delete")}</button>` : ""}
      </form>
    </div>`;
}

// Changing the type changes which fields show, so keep what has been typed so far.
function changeRecurringKind(form) {
  const values = form.elements;
  sheet.draft = {
    ...sheet.draft, kind: values.kind.value, amount: values.amount.value, account: values.account.value,
    frequency: values.frequency.value, date: values.date.value, note: values.note.value, category: "",
  };
  renderRecurringForm();
}

function recurringRow(form) {
  const values = form.elements;
  const kind = values.kind.value;
  const transfer = kind === "transfer";
  const amount = parseMoney(values.amount.value);
  if (!amount || amount < 0) return toast(t("needAmount"));
  if (!values.date.value) return toast(t("needDate"));
  const toAccount = transfer ? values.to.value : null;
  if (transfer && values.account.value === toAccount) return toast(t("sameAccount"));
  const old = sheet.id ? find("recurring", sheet.id) : null;
  const moved = !old || old.next_on !== values.date.value;
  return {
    id: sheet.id ?? newId(),
    book_id: old ? old.book_id : currentBook().id,
    kind,
    amount,
    account_id: values.account.value,
    to_account_id: toAccount,
    category_id: transfer ? null : values.category.value,
    note: values.note.value.trim(),
    frequency: values.frequency.value,
    next_on: values.date.value,
    anchor_day: moved ? Number(values.date.value.slice(8)) : old.anchor_day,
    created_at: createdAt("recurring"),
  };
}

function nextDate(rule, date) {
  const [year, month, day] = date.split("-").map(Number);
  if (rule.frequency === "weekly") return localDate(new Date(year, month - 1, day + 7));
  const targetMonth = rule.frequency === "monthly" ? month : month + 11; // month is 1-12, so this is the next month's index
  const first = new Date(year, targetMonth, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return localDate(new Date(first.getFullYear(), first.getMonth(), Math.min(rule.anchor_day, lastDay)));
}

// The same rule and date always give the same id, so two phones opening at once can't add it twice.
async function recurringEntryId(ruleId, date) {
  const bytes = new TextEncoder().encode(`${ruleId}:${date}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = [...hash.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Adds every entry that has come due. Saves the entries before moving the rule on, so a
// failure part way simply tries again next time without losing or doubling anything.
async function runRecurring() {
  const today = localDate();
  let added = 0;
  for (const rule of [...state.data.recurring]) {
    const rows = [];
    let next = rule.next_on;
    while (next <= today && rows.length < MAX_CATCH_UP) {
      rows.push({
        id: await recurringEntryId(rule.id, next), book_id: rule.book_id, kind: rule.kind, amount: rule.amount,
        account_id: rule.account_id, to_account_id: rule.to_account_id, category_id: rule.category_id,
        note: rule.note, occurred_on: next, created_at: new Date().toISOString(),
      });
      next = nextDate(rule, next);
    }
    if (!rows.length) continue;
    await store.save("transactions", rows);
    rows.forEach((row) => putLocal("transactions", row));
    await saveRow("recurring", { ...rule, next_on: next });
    added += rows.length;
  }
  return added;
}
