# finance-erp-web

Next.js 16 web app for **Finance ERP OS**. Uses the database API documented in `../finance-erp-sql/README.md`.

## First-time setup (Windows, VS Code terminal)

```powershell
cd "D:\Sumant\Personal ERP\PERSONALERP\finance-erp-web"
npm install
copy .env.example .env.local
```

Open `.env.local` and paste your two values from **Supabase → Project Settings → API**:

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Only the **publishable** key goes here. Never put the `service_role` / secret key in this app.

## Run

```powershell
npm run dev
```

Open http://localhost:3000 and create your account on the login page.

## Batch 1 (done)

| Screen | Features |
|---|---|
| Login | Sign in / create account |
| Layout | Collapsible sidebar, phone drawer, light/dark mode, name + role badge |
| Dashboard | Income, expenses, savings, available balance, card outstanding, pending/overdue, net worth, budget, emergency fund, upcoming 30 days, account balances, month picker |
| Accounts | Add/edit/delete, opening balance, credit card limit + bill/due days, active filter, CSV export |
| Account ledger | Running balance, CSV export, A4 print |
| Transactions | All 7 types, search, type pills, account + date filters, pagination, edit, delete with reversal, show deleted, daily spending (many lines at once), CSV export |
| Masters | Categories, payment modes, commitment types, goal types (add, edit, deactivate, delete) |

Next batches: credit cards, commitments + carry-forward, monthly plan, goals, reports, calendar, import.

## Notes

* Pages are client components that call Supabase directly. Every money change goes through a database RPC, so web and mobile share the same rules.
* `src/proxy.ts` (Next 16's name for middleware) refreshes the session and sends signed-out users to `/login`.
* Fonts are the system font stack (no Google Fonts download).
