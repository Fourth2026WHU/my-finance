# My Finance

A personal money tracker for the phone. It is plain HTML, CSS and JavaScript, with nothing to install or build.

## Features

- Add expenses, income and transfers with a calculator keypad
- Edit or delete any entry
- Separate books, such as everyday and travel
- Monthly summary and entries grouped by day
- Calendar with a total for each day
- Charts of spending by category and income against expense by day
- Search across all books
- Wallet with net worth, assets, debt and a live balance for each account
- Thai and English

## Try it

Open `index.html` through a web server. With no Supabase details in `config.js`, the app runs in practice mode, which saves on that device only.

## Connect Supabase

Use a new project. Never use the Inventory Tracker project.

1. Create a new project at supabase.com.
2. Open SQL Editor, paste all of `supabase/schema.sql` and run it.
3. Open Project Settings, then API. Copy the Project URL and the publishable key into `config.js`.
4. Publish the app, open it and create your account.
5. In Authentication, turn off new sign-ups so no one else can make an account. Other accounts could never see your data, but they would use your free space.

Never put the secret or service_role key in `config.js`.

## Put it on your iPhone

1. Open the published address in Safari.
2. Tap Share, then Add to Home Screen.

## Good to know

- A free Supabase project pauses after about a week of low activity. Restart it from the Supabase dashboard. Your data stays.
- Don't store real card or account numbers. Use nicknames such as "KTC".
- All amounts are in Thai baht. Balances are always worked out from the entries.
