import { useCallback, useEffect, useState } from "react";

import { listRecentWorks, onRecentWorksUpdate } from "../lib/storage";
import type { RecentWork } from "../lib/storage";

type RecentWorksResult = {
  items: RecentWork[];
  refresh: () => void;
};

export const useRecentWorks = (): RecentWorksResult => {
  const [items, setItems] = useState<RecentWork[]>(() => listRecentWorks());

  const refresh = useCallback(() => {
    setItems(listRecentWorks());
  }, []);

  useEffect(() => onRecentWorksUpdate(refresh), [refresh]);

  return { items, refresh };
};
