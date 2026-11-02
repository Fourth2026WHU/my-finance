-- Budgets and saving goals. Run this once in the My Finance project (SQL Editor),
-- before publishing the version of the app that uses them.
-- Do not run it in the Inventory Tracker project.

-- A budget repeats every month. With no category it is the limit for the whole book.
create table public.budgets (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null,
  category_id uuid,
  amount bigint not null check (amount > 0 and amount <= 999999999999),
  created_at timestamptz not null default now(),
  foreign key (book_id, user_id) references public.books (id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete cascade
);

create unique index budgets_one_overall on public.budgets (book_id) where category_id is null;
create unique index budgets_one_per_category on public.budgets (book_id, category_id) where category_id is not null;
create index budgets_category on public.budgets (category_id, user_id);

create table public.goals (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  icon text not null,
  target bigint not null check (target > 0 and target <= 999999999999),
  saved bigint not null default 0 check (saved >= 0 and saved <= 999999999999),
  created_at timestamptz not null default now()
);

alter table public.budgets enable row level security;
alter table public.goals enable row level security;

create policy "own budgets" on public.budgets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own goals" on public.goals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.budgets, public.goals from anon;
grant select, insert, update, delete on public.budgets, public.goals to authenticated;
