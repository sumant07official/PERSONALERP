"use client";

import { useCallback, useEffect, useState } from "react";
import { listAccounts, listGoalOptions, listMasters, listOpenInstallments } from "@/lib/api";
import type { Lookups } from "./txn-form";

/** Accounts, categories, modes, goals and open installments used by every money form. */
export function useLookups() {
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      const [accounts, categories, modes, goals, installments] = await Promise.all([
        listAccounts(), listMasters("categories"), listMasters("payment_modes"), listGoalOptions(), listOpenInstallments(),
      ]);
      setLookups({ accounts, categories, modes, goals, installments });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { lookups, error, reload };
}
