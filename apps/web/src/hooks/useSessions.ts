import { useCallback, useEffect, useState } from "react";

import { listSessions, onSessionsUpdate } from "../lib/storage";
import type { SessionIndexItem } from "../lib/storage";

type SessionsResult = {
  items: SessionIndexItem[];
  refresh: () => void;
};

export const useSessions = (): SessionsResult => {
  const [items, setItems] = useState<SessionIndexItem[]>(() => listSessions());

  const refresh = useCallback(() => {
    setItems(listSessions());
  }, []);

  useEffect(() => onSessionsUpdate(refresh), [refresh]);

  return { items, refresh };
};
