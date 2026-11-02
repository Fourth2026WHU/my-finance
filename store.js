// Saving and loading. The rest of the app only uses store.*, so it works the same
// in practice mode (localStorage) and with Supabase.
const LOCAL_KEY = "myFinance.data.v1";
const TABLES = ["books", "accounts", "categories", "transactions", "budgets", "goals", "recurring"];
const PAGE_SIZE = 1000; // Supabase returns at most this many rows per request

const db = SUPABASE_URL && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

function readLocal() {
  const empty = Object.fromEntries(TABLES.map((table) => [table, []]));
  try {
    return { ...empty, ...JSON.parse(localStorage.getItem(LOCAL_KEY)) };
  } catch {
    return empty;
  }
}

function writeLocal(data) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
}

async function loadTable(table) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db.from(table).select("*").order("id").range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

const store = {
  needsLogin: Boolean(SUPABASE_URL),

  async currentUser() {
    const { data } = await db.auth.getSession();
    return data.session ? data.session.user : null;
  },

  async signIn(email, password) {
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },

  // Returns false when Supabase wants the email confirmed before the first login.
  async signUp(email, password) {
    const { data, error } = await db.auth.signUp({ email, password });
    if (error) throw error;
    return Boolean(data.session);
  },

  async signOut() {
    await db.auth.signOut();
  },

  async loadAll() {
    if (!db) return readLocal();
    const tables = await Promise.all(TABLES.map(loadTable));
    return Object.fromEntries(TABLES.map((table, i) => [table, tables[i]]));
  },

  async save(table, rows) {
    const list = Array.isArray(rows) ? rows : [rows];
    if (db) {
      const { error } = await db.from(table).upsert(list);
      if (error) throw error;
      return;
    }
    const data = readLocal();
    list.forEach((row) => {
      const index = data[table].findIndex((item) => item.id === row.id);
      if (index >= 0) data[table][index] = row;
      else data[table].push(row);
    });
    writeLocal(data);
  },

  async remove(table, id) {
    if (db) {
      const { error } = await db.from(table).delete().eq("id", id);
      if (error) throw error;
      return;
    }
    const data = readLocal();
    data[table] = data[table].filter((item) => item.id !== id);
    if (table === "books") {
      data.transactions = data.transactions.filter((item) => item.book_id !== id);
      data.budgets = data.budgets.filter((item) => item.book_id !== id);
      data.recurring = data.recurring.filter((item) => item.book_id !== id);
    }
    if (table === "categories") data.budgets = data.budgets.filter((item) => item.category_id !== id);
    writeLocal(data);
  },
};
