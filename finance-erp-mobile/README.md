# finance-erp-mobile

Android app (Expo SDK 58, React Native 0.88, TypeScript) for **Finance ERP OS**.
Same Supabase database, same RPCs and the same `src/lib/api.ts` contract as the web app, so business rules are identical.

## First-time setup (Windows, VS Code terminal)

```powershell
cd "D:\Sumant\Personal ERP\PERSONALERP\finance-erp-mobile"
npm install
copy .env.example .env.local
notepad .env.local
```

Put the same two values you used for the web app (names start with `EXPO_PUBLIC_`):

```
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

## Run on your Android phone (Expo Go)

1. Install **Expo Go** from the Play Store.
2. PC and phone on the **same Wi-Fi**.
3. `npx expo start` → scan the QR code with Expo Go.
   If the office network blocks it: `npx expo start --tunnel`.

## Batch M1 (done)

| Screen | Features |
|---|---|
| Login | Sign in / create account; session stored encrypted (SecureStore key + AES) |
| Drawer | Dark header, slide-out menu with logo, name, email, role badge, role-filtered items, sign out |
| Dashboard | All web metrics, budget, emergency fund, upcoming, balances, month switch, pull-to-refresh |
| Transactions | All 7 types (full-screen form), search, filter sheet (types, account, dates, deleted), infinite scroll, edit, delete with reason, daily spending, CSV share |
| Accounts | List with filters, add/edit (credit limit, bill/due day), opening balance change, delete, CSV share |
| Ledger | Running balance per account, CSV share |
| Masters | Categories, payment modes, commitment types, goal types (add, edit, active toggle, delete) |

Next: M2 credit cards, commitments, monthly plan · M3 goals, reports, calendar, assets, tasks, import · then EAS APK build.
