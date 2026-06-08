import { installPerfProbe } from "@/debug/perfProbe";

installPerfProbe();

import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App.tsx";
import { initI18n } from "@/shared/I18nTranslator.ts";
import { Buffer } from "buffer";
(globalThis as any).Buffer = Buffer;

const closeSplash = async () => {
  if (!__WITH_TAURI__) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    console.log("loaded");
    await invoke("splash_off");
  } catch (e) {
    console.error("invoke failed:", e);
  }
};

import { Profiler } from "react";

function onRender(
  id: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number
) {
  if (actualDuration > 8) {
    console.warn(`[React Profiler] ${id} ${phase}`, {
      actualDuration,
      baseDuration,
      startTime,
      commitTime,
    });
  }
}

const bootstrap = async () => {
  await initI18n();
  // ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  //   <React.StrictMode>
  //     <App />
  //   </React.StrictMode>
  // );

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <Profiler id="AppRoot" onRender={onRender}>
      <App />
    </Profiler>
  );

  await closeSplash();
};

void bootstrap().catch(console.error);
