import React, {useEffect, useRef, useState} from "react";
import {TextGenerateEffect} from "@/components/ui/text-generate-effect.tsx";
import {useGlobalLogStore} from "@/store/globalLogStore.ts";
import {formatIsoToReadableTime} from "@/lib/utils.ts";
import {motion} from "framer-motion";
import {useTheme} from "@/hooks/useTheme.tsx";
import {useWebSocketStore} from "../store/websocketStore";
import {useTranslation} from "react-i18next";
import {Info, KeyRound, ShieldCheck} from "lucide-react";

const baseUrl = import.meta.env.BASE_URL;

interface LoadingPageProps {
  message?: string;
}

const statusColorMap: Record<string, string> = {
  INFO: "var(--color-primary-500)",
  WARNING: "var(--color-yello-500)",
  ERROR: "var(--color-red-500)",
  CRITICAL: "var(--color-purple-500)",
};

export function AutoScrollTerminal({children}: { children: React.ReactNode }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({behavior: "smooth"});
  }, [children]);

  return (
    <div className="w-full h-full opacity-50 scrollbar-hide font-mono overflow-auto p-2 text-sm">
      {children}
      <div ref={endRef}/>
    </div>
  );
}

export const LoadingPage: React.FC<LoadingPageProps> = ({message = "Loading..."}) => {
  const globalLogData = useGlobalLogStore((state) => state.globalLogData);
  const authPhase = useWebSocketStore((state) => state._auth_phase);
  const authError = useWebSocketStore((state) => state._auth_error);
  const serverInitialized = useWebSocketStore((state) => state._server_initialized);
  const serverVerified = useWebSocketStore((state) => state._server_verified);
  const startAuthFlow = useWebSocketStore((state) => state.startAuthFlow);
  const submitPassword = useWebSocketStore((state) => state.submitPassword);
  const {theme} = useTheme();

  useEffect(() => {
    if (authPhase === "idle" || authPhase === "revoked") {
      void startAuthFlow();
    }
  }, [authPhase, startAuthFlow]);

  const loadingMessage =
    authPhase === "control_connecting"
      ? "Verifying server identity..."
      : authPhase === "initializing"
        ? "Initializing system password..."
        : authPhase === "authenticating"
          ? "Authenticating session..."
          : message;

  return (
    <>
      <div className="fixed inset-0 bg-[var(--color-slate-100)] dark:bg-[oklch(12.9%_0.042_264.695)] overflow-hidden">
        <img
          src={theme === "light" ? `${baseUrl}images/bg-light.webp` : `${baseUrl}images/bg-dark.webp`}
          alt="Loading BG"
          className="w-full h-full object-cover object-center"
        />
      </div>

      <div className="fixed w-full h-full p-2">
        <div className="w-full h-full bg-slate-100/80 dark:bg-slate-900/80 backdrop-blur-[5px] rounded-md p-2 border border-2 border-primary-500/70">
          <AutoScrollTerminal>
            {globalLogData.map((log, idx) => (
              <div className="flex" key={`${log.time}-${idx}`}>
                <div className="min-w-[80px] text-slate-600 dark:text-slate-400">
                  <TextGenerateEffect words={formatIsoToReadableTime(log.time)} mode="all"/>
                </div>
                <div
                  className="min-w-[80px] flex justify-end mr-2 font-bold"
                  style={{color: statusColorMap[log.level]}}
                >
                  <TextGenerateEffect words={log.level} mode="all"/>
                </div>
                <motion.div
                  className="flex-1 border-l-3 pl-4"
                  style={{
                    borderColor: statusColorMap[log.level],
                    whiteSpace: "pre-wrap",
                    borderLeftWidth: log.level === "INFO" ? "3px" : "5px",
                    color: log.level === "INFO" ? "inherit" : statusColorMap[log.level],
                    fontWeight: log.level === "INFO" ? "inherit" : "bold",
                  }}
                  initial={{opacity: 0, filter: "blur(10px)"}}
                  animate={{opacity: 1, filter: "blur(0px)"}}
                  transition={{duration: 0.5}}
                >
                  {log.message}
                </motion.div>
              </div>
            ))}
          </AutoScrollTerminal>
        </div>
      </div>

      <div className="z-10 flex flex-col items-center justify-center w-full h-full">
        <div
          className="fixed"
          style={{
            marginTop: "calc(var(--spacing) * -15)",
          }}
        >
          <img
            src={`${baseUrl}images/logo.png`}
            alt="App Logo"
            className="w-36 h-36 mb-6 fixed rounded-full drop-shadow-[0_0_80px_rgba(0,215,255,0.8)] dark:drop-shadow-[0_0_80px_rgba(59,130,246,0.8)]"
          />

          <div
            className="animate-spin rounded-full h-40 w-40 border-t-4 border-b-4 drop-shadow-[0_0_10px_rgba(255,255,246,0.8)]
              border-primary-500 dark:border-primary-300 mb-6 dark:drop-shadow-[0_0_10px_rgba(255,255,246,0.8)]"
            style={{
              marginTop: "calc(var(--spacing) * -2)",
              marginLeft: "calc(var(--spacing) * -2)",
            }}
          />
        </div>

        <p
          className="text-lg font-bold text-slate-500 dark:text-slate-200 absolute mt-40 py-1 px-4 rounded-lg font-mono
              bg-[#eeeeeeee] dark:bg-[#0000002f] backdrop-blur-[5px] border-[#90a1b977] dark:border-slate-700 border"
        >
          {loadingMessage}
        </p>
      </div>

      <PasswordInputModal
        open={
          authPhase === "server_verified" ||
          authPhase === "waiting_password" ||
          authPhase === "initializing" ||
          authPhase === "authenticating"
        }
        setupMode={!serverInitialized}
        serverVerified={serverVerified}
        submitting={authPhase === "initializing" || authPhase === "authenticating"}
        error={authError}
        onConfirm={async (password: string) => {
          await submitPassword(password);
        }}
      />
    </>
  );
};

const overlayCls = "fixed inset-0 flex items-center justify-center bg-black/50 z-50 backdrop-blur-sm";

export const PasswordInputModal: React.FC<{
  open: boolean;
  setupMode: boolean;
  serverVerified: boolean;
  submitting: boolean;
  error: string | null;
  onConfirm: (password: string) => void | Promise<void>;
}> = ({open, setupMode, serverVerified, submitting, error, onConfirm}) => {
  const {t} = useTranslation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open) {
      setPassword("");
      setConfirmPassword("");
      setLocalError("");
    }
  }, [open]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (!password.trim()) {
      setLocalError("Please enter the current system password.");
      return;
    }
    if (setupMode && password !== confirmPassword) {
      setLocalError("The two passwords do not match.");
      return;
    }
    setLocalError("");
    await onConfirm(password.trim());
  };

  return (
    <div className={overlayCls}>
      <motion.div
        initial={{opacity: 0, scale: 0.96, y: 10}}
        animate={{opacity: 1, scale: 1, y: 0}}
        exit={{opacity: 0, scale: 0.95, y: 10}}
        transition={{duration: 0.18, ease: "easeOut"}}
        className="w-[440px] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-600 p-3">
            {serverVerified ? <ShieldCheck className="w-6 h-6"/> : <KeyRound className="w-6 h-6"/>}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {setupMode ? "Initialize System Password" : "Enter System Password"}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {serverVerified
                ? setupMode
                  ? "Server identity verified. Set the first shared system password."
                  : "Server identity verified. Enter the current shared system password."
                : "Waiting for server identity verification."}
            </p>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
            {setupMode ? "New Password" : t("secretLabel") || "Password"}
          </label>
          <div className="flex items-center gap-2 border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2 bg-slate-50 dark:bg-slate-800 focus-within:ring-2 focus-within:ring-primary-500 transition">
            <KeyRound className="w-4 h-4 text-slate-500"/>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={setupMode ? "Set the system password..." : "Enter the current system password..."}
              className="flex-1 bg-transparent outline-none text-slate-800 dark:text-slate-100 placeholder-slate-400 text-sm transition"
              disabled={!serverVerified || submitting}
            />
          </div>
        </div>

        {setupMode && (
          <div className="mb-4">
            <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">Confirm Password</label>
            <div className="flex items-center gap-2 border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2 bg-slate-50 dark:bg-slate-800 focus-within:ring-2 focus-within:ring-primary-500 transition">
              <KeyRound className="w-4 h-4 text-slate-500"/>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repeat the new system password..."
                className="flex-1 bg-transparent outline-none text-slate-800 dark:text-slate-100 placeholder-slate-400 text-sm transition"
                disabled={!serverVerified || submitting}
              />
            </div>
          </div>
        )}

        {(localError || error) && (
          <p className="mb-4 text-xs text-red-500 dark:text-red-400">{localError || error}</p>
        )}

        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-4">
          <Info className="w-4 h-4 text-primary-500"/>
          <span>
            {setupMode
              ? "The password is only kept in memory long enough to derive the authenticated session."
              : "The password is never persisted in the browser and is only used for this authenticated session."}
          </span>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={handleConfirm}
            disabled={!serverVerified || submitting}
            className="px-4 py-2 rounded-md bg-primary-600 hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium shadow-sm transition-colors"
          >
            {submitting ? "Please wait..." : setupMode ? "Initialize" : t("confirm") || "Confirm"}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

