-- My Finance database. Run this once in a NEW Supabase project (SQL Editor).
-- Do not run it in the Inventory Tracker project.
-- Amounts are whole satang, so 12.50 baht is stored as 1250.

create table public.books (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  icon text not null,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.accounts (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null check (kind in ('cash', 'bank', 'credit', 'ewallet')),
  icon text not null,
  opening_balance bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.categories (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null check (kind in ('expense', 'income')),
  icon text not null,
  sort integer not null default 0,
  unique (id, user_id)
);

-- The two-column foreign keys stop a row pointing at another person's book, account or category.
create table public.transactions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null,
  kind text not null check (kind in ('expense', 'income', 'transfer')),
  amount bigint not null check (amount > 0 and amount <= 999999999999),
  account_id uuid not null,
  to_account_id uuid,
  category_id uuid,
  note text not null default '' check (char_length(note) <= 200),
  occurred_on date not null,
  created_at timestamptz not null default now(),
  foreign key (book_id, user_id) references public.books (id, user_id) on delete cascade,
  foreign key (account_id, user_id) references public.accounts (id, user_id),
  foreign key (to_account_id, user_id) references public.accounts (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id),
  check (
    (kind = 'transfer' and to_account_id is not null and to_account_id <> account_id and category_id is null)
    or (kind <> 'transfer' and to_account_id is null and category_id is not null)
  )
);

create index transactions_user_book_date on public.transactions (user_id, book_id, occurred_on desc);
create index transactions_account on public.transactions (account_id, user_id);
create index transactions_to_account on public.transactions (to_account_id, user_id);
create index transactions_category on public.transactions (category_id, user_id);

-- Each person can only ever see and change their own rows.
alter table public.books enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;

create policy "own books" on public.books for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own accounts" on public.accounts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own categories" on public.categories for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own transactions" on public.transactions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.books, public.accounts, public.categories, public.transactions from anon;
grant select, insert, update, delete
  on public.books, public.accounts, public.categories, public.transactions to authenticated;
