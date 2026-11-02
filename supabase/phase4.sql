-- Recurring entries. Run this once in the My Finance project (SQL Editor),
-- before publishing the version of the app that uses them.
-- Do not run it in the Inventory Tracker project.

-- anchor_day keeps a monthly rule on the 31st after a shorter month moved it to the 28th.
create table public.recurring (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null,
  kind text not null check (kind in ('expense', 'income', 'transfer')),
  amount bigint not null check (amount > 0 and amount <= 999999999999),
  account_id uuid not null,
  to_account_id uuid,
  category_id uuid,
  note text not null default '' check (char_length(note) <= 200),
  frequency text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  next_on date not null,
  anchor_day smallint not null check (anchor_day between 1 and 31),
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

create index recurring_book on public.recurring (book_id, user_id);
create index recurring_account on public.recurring (account_id, user_id);
create index recurring_to_account on public.recurring (to_account_id, user_id);
create index recurring_category on public.recurring (category_id, user_id);

alter table public.recurring enable row level security;

create policy "own recurring" on public.recurring for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.recurring from anon;
grant select, insert, update, delete on public.recurring to authenticated;
