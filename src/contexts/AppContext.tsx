import React, {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { ConfigProfile } from "@/types/app";
import { GlobalSelectProvider } from "@/components/ui/select-global";
import { useWebSocketStore } from "@/store/websocketStore.ts";
import { StorageUtil } from "@/lib/storage.ts";
import { UISettingsProvider } from "@/contexts/UISettingsProvider";

interface AppContextType {
  profiles: ConfigProfile[];
  activeProfile: ConfigProfile | null;
  setActiveProfile: (profile: ConfigProfile | null) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{
  children: ReactNode;
  setReady: (value: boolean) => void;
}> = ({ children, setReady }) => {
  const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<ConfigProfile | null>(
    null,
  );

  const init = useWebSocketStore((s) => s.init);
  const authPhase = useWebSocketStore((s) => s._auth_phase);
  const allDataInitialized = useWebSocketStore((s) => s._all_data_initialized);
  const initiating = useWebSocketStore((s) => s._initiating);
  const configStore = useWebSocketStore((s) => s.configStore);

  useEffect(() => {
    if (authPhase === "authenticated" && !allDataInitialized) {
      void init();
    }
  }, [authPhase, allDataInitialized, init]);

  useEffect(() => {
    const list: ConfigProfile[] = Object.keys(configStore).map((key) => ({
      id: key,
      name: configStore[key].name,
      settings: configStore[key],
    }));

    const tabOrder = StorageUtil.get("tabOrder") as string[] | null;

    if (tabOrder && tabOrder.length > 0) {
      list.sort((a, b) => {
        const ia = tabOrder.indexOf(a.id);
        const ib = tabOrder.indexOf(b.id);

        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;

        return ia - ib;
      });
    }

    setProfiles(list);

    if (list.length === 0) {
      setActiveProfile(null);
      return;
    }

    setActiveProfile((current) => {
      if (!current) {
        return list[0];
      }

      const nextActiveProfile = list.find((item) => item.id === current.id);

      return nextActiveProfile ?? list[0];
    });
  }, [configStore]);

  useEffect(() => {
    // const authenticated = authPhase === "authenticated";
    const authenticated = true;

    const hasActiveProfile = activeProfile !== null;
    const initialized = !initiating;
    const readyForShow = authenticated && hasActiveProfile && initialized;

    console.log("authenticated", authenticated);
    console.log("allDataInitialized", allDataInitialized);
    console.log("hasActiveProfile", hasActiveProfile);
    console.log("initialized", initialized);
    console.log("=========================================");

    setReady(readyForShow);
  }, [
    authPhase,
    allDataInitialized,
    setReady,
    activeProfile,
    initiating,
  ]);

  const value = useMemo<AppContextType>(
    () => ({
      profiles,
      activeProfile,
      setActiveProfile,
    }),
    [profiles, activeProfile],
  );

  return (
    <AppContext.Provider value={value}>
      <UISettingsProvider>
        <GlobalSelectProvider>{children}</GlobalSelectProvider>
      </UISettingsProvider>
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);

  if (context === undefined) {
    throw new Error("useApp must be used within an AppProvider");
  }

  return context;
};