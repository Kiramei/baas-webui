import React, { ChangeEvent, useEffect, useRef, useState } from "react";
import {
  Camera,
  Circle,
  Keyboard,
  List,
  Loader2,
  Play,
  Power,
  Settings,
  Squircle,
  Volume1,
  Volume2,
} from "lucide-react";
import { CornerBox } from "@/components/ui/CornerBox.tsx";
import { Modal } from "@/components/ui/Modal.tsx";
import { t } from "i18next";
import { StreamClientScrcpy, BTN_FUNC_MAP } from "./remote/StreamClientScrcpy";
import { BasePlayer, QualityParsed } from "./remote/player/BasePlayer";
import { BroadwayPlayer } from "@/components/remote/player/BroadwayPlayer";
import { MsePlayer } from "@/components/remote/player/MsePlayer";
import { TinyH264Player } from "@/components/remote/player/TinyH264Player";
import { WebCodecsPlayer } from "@/components/remote/player/WebCodecsPlayer";
import { useUISettings } from "@/contexts/UISettingsProvider.tsx";
import { VideoSettings } from "@/components/remote/CommonUtil.ts";
import { Size } from "@/components/remote/GeometryInfo.ts";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/Accordion.tsx";
import { FormInput } from "@/components/ui/FormInput.tsx";
import CButton from "@/components/ui/CButton.tsx";
import SwitchButton from "@/components/ui/SwitchButton.tsx";
import { StorageUtil } from "@/lib/storage.ts";
import {
  CommandControlMessage,
  ControlMessage,
  KeyCodeControlMessage,
} from "@/components/remote/MessageCenter.ts";
import { KeyEvent } from "@/components/remote/KeySpaceMap.ts";
import { SlideOutButton } from "@/components/ui/SlideOutButton.tsx";

StreamClientScrcpy.registerPlayer(BroadwayPlayer);
StreamClientScrcpy.registerPlayer(MsePlayer);
StreamClientScrcpy.registerPlayer(TinyH264Player);
StreamClientScrcpy.registerPlayer(WebCodecsPlayer);

/**
 * Connection state used by the UI layer.
 *
 * - connecting: the player is waiting for a valid decoder configuration
 *   or for the first successfully rendered frame.
 * - playing: the decoder has already rendered at least one frame.
 */
enum ConnectionStatus {
  connecting = "connecting",
  connected = "connected",
}

/**
 * Remote display component.
 *
 * This component is responsible for:
 * 1. Maintaining a WebSocket connection to receive encoded video.
 * 2. Initializing and driving a WebCodecs VideoDecoder instance.
 * 3. Rendering decoded frames into a detached canvas element.
 * 4. Moving the same canvas between the thumbnail host and the modal host.
 * 5. Capturing pointer gestures on the modal overlay and forwarding them
 *    to the backend as normalized remote-control events.
 */
export const RemoteDisplay: React.FC<{ profileId: string }> = ({ profileId }) => {
  /**
   * The actual rendering canvas is created imperatively and stored in a ref.
   * We do this to keep the same canvas element alive when it is moved between
   * the inline preview container and the modal container.
   */
  const touchRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<BasePlayer | null>(null);
  const scrcpyClientRef = useRef<StreamClientScrcpy | null>(null);
  /**
   * Host node for the inline thumbnail view.
   */
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  /**
   * Small textual status area shown while connecting or on transient failures.
   */
  const statusRef = useRef<HTMLDivElement | null>(null);

  /**
   * UI-level connection state.
   */
  const [connectionState, setConnectionState] = useState<ConnectionStatus>(
    ConnectionStatus.connecting
  );

  /**
   * Get the RemoteSettings from Hook. And the specific settings.
   */
  const { uiSettings, setUiSettings } = useUISettings();
  const [showStatus, setShowStatus] = useState<boolean>(uiSettings.remoteSettings.showStatus);
  const [maxWidth, setMaxWidth] = useState<number>(uiSettings.remoteSettings.maxWidth);
  const [maxHeight, setMaxHeight] = useState<number>(uiSettings.remoteSettings.maxHeight);
  const [maxFPS, setMaxFPS] = useState<number>(uiSettings.remoteSettings.maxFPS);
  const [iFrameRate, setIFrameRate] = useState<number>(uiSettings.remoteSettings.iFrameRate);
  const [bitRate, setBitRate] = useState<number>(uiSettings.remoteSettings.bitRate);
  const [quality, setQuality] = useState<QualityParsed>({
    padAvgDecoded: "",
    padAvgDropped: "",
    padAvgInput: "",
    padDecoded: "",
    padDropped: "",
    padInput: "",
    prettyAvgBytes: "",
    prettyBytes: "",
  });
  const [keyListenStatus, setKeyListenStatus] = useState<boolean>(false);
  const [clipBoardText, setClipBoardText] = useState<string>("");

  const setValue = (
    func: React.Dispatch<React.SetStateAction<number>>,
    e: ChangeEvent<HTMLInputElement>
  ) => {
    const { value } = e.target;
    func(parseInt(value, 10));
  };

  const constructVideoSetting: () => VideoSettings = () => {
    return new VideoSettings({
      lockedVideoOrientation: -1,
      bounds: new Size(uiSettings.remoteSettings.maxWidth, uiSettings.remoteSettings.maxHeight),
      maxFps: uiSettings.remoteSettings.maxFPS,
      bitrate: uiSettings.remoteSettings.bitRate,
      iFrameInterval: uiSettings.remoteSettings.iFrameRate,
      sendFrameMeta: false,
    });
  };

  /**
   * Remote Tools functionality
   */
  const screenshot = () => {
    const deviceName = scrcpyClientRef.current?.getDeviceName();
    const imageDataURL = playerRef.current?.getImageDataURL();
    StorageUtil.download(`${deviceName}_${new Date().toLocaleString()}.png`, null, imageDataURL);
  };

  const btnTrigger = (key: keyof typeof BTN_FUNC_MAP, type: number): (() => void) => {
    return () => {
      const action = BTN_FUNC_MAP[key];
      const type_ = type === 0 ? KeyEvent.ACTION_DOWN : KeyEvent.ACTION_UP;
      const event = new KeyCodeControlMessage(type_, action, 0, 0);
      // eslint-disable-next-line react-hooks/refs
      scrcpyClientRef.current?.sendMessage(event);
    };
  };

  const toggleKeyboard = () => {
    const newKeyListenStatus = !keyListenStatus;
    setKeyListenStatus(newKeyListenStatus);
    scrcpyClientRef.current!.setHandleKeyboardEvents(newKeyListenStatus);
  };

  const saveSettings = () => {
    setUiSettings({
      ...uiSettings,
      remoteSettings: {
        ...uiSettings.remoteSettings,
        maxWidth: maxWidth,
        maxHeight: maxHeight,
        maxFPS: maxFPS,
        bitRate: bitRate,
        iFrameRate: iFrameRate,
      },
    });
    const videoSetting = constructVideoSetting();
    const commandMsg = CommandControlMessage.createSetVideoSettingsCommand(videoSetting);
    scrcpyClientRef.current!.sendMessage(commandMsg);
  };

  const toggleShowStatus = (value: boolean) => {
    setShowStatus(value);
    setUiSettings({
      ...uiSettings,
      remoteSettings: {
        ...uiSettings.remoteSettings,
        showStatus: value,
      },
    });
    playerRef.current?.setShowQualityStats(value);
  };

  const setClipBoard = () => {
    const commandMsg = CommandControlMessage.createSetClipboardCommand(clipBoardText);
    scrcpyClientRef.current!.sendMessage(commandMsg);
  };

  const getClipBoard = () => {
    const commandMsg = new CommandControlMessage(ControlMessage.TYPE_GET_CLIPBOARD);
    scrcpyClientRef.current!.sendMessage(commandMsg);
  };

  const onClipBoardReceived = (text: string) => {
    setClipBoardText(text);
    try {
      navigator.clipboard.writeText(text).then();
    } catch (err) {
      console.error("Clipboard write failed:", err);
    }
  };

  /**
   * Modal visibility state.
   */
  const [modalOpen, setModalOpen] = useState<boolean>(false);

  /**
   * Initialize canvas, WebSocket, and VideoDecoder exactly once.
   *
   * This effect intentionally creates the canvas imperatively and keeps the
   * decoder state local to the effect, because the decoder lifecycle should
   * be tightly coupled to the socket session rather than to React re-renders.
   */
  useEffect(() => {
    if (canvasRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.className = "w-full h-full block select-none";
    const video = document.createElement("video");
    video.className = "absolute top-0 w-full h-full block select-none";
    const touch = document.createElement("canvas");
    touch.className = "absolute top-0 w-full h-full block select-none z-1";

    canvasRef.current = canvas;
    videoRef.current = video;
    touchRef.current = touch;

    canvasHostRef.current?.appendChild(canvas);
    canvasHostRef.current?.appendChild(video);
    canvasHostRef.current?.appendChild(touch);

    const hash = location.hash.replace(/^#!/, "");
    const parsedQuery = new URLSearchParams(hash);
    const udid = "192.168.31.22:5555";
    parsedQuery.set("action", "stream");
    parsedQuery.set("player", "mse");
    parsedQuery.set("udid", udid);
    parsedQuery.set(
      "ws",
      "ws://192.168.31.116:8000/?action=proxy-adb&remote=tcp:8886&udid=192.168.31.22:5555"
    );
    const player = new MsePlayer(udid, undefined, MsePlayer.playerFullName, video, touch);
    playerRef.current = player;
    playerRef.current?.setShowQualityStats(showStatus);
    player.onStatsUpdate((q) => setQuality(q));
    const videoSettings = constructVideoSetting();
    scrcpyClientRef.current = StreamClientScrcpy.start(
      parsedQuery,
      undefined,
      player,
      false,
      videoSettings
    );
    scrcpyClientRef.current?.setOnClipBoxReceived(onClipBoardReceived);
    setConnectionState(ConnectionStatus.connected);
    return () => {
      // setConnectionState(ConnectionStatus.connecting);
    };
  }, []);

  /**
   * Move the persistent canvas node between the inline preview container and
   * the modal container whenever the modal visibility changes.
   *
   * This approach avoids recreating the canvas and losing decoder output state.
   */
  useEffect(() => {
    const touch = touchRef.current;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!touch) return;
    if (!canvas) return;
    if (!video) return;

    if (modalOpen) {
      const modalMount = document.getElementById("remote-ctrl-mount");
      if (modalMount && canvas.parentNode !== modalMount) {
        modalMount.appendChild(canvas);
      }
      if (modalMount && video.parentNode !== modalMount) {
        modalMount.appendChild(video);
      }
      if (modalMount && touch.parentNode !== modalMount) {
        modalMount.appendChild(touch);
      }
    } else {
      const host = canvasHostRef.current;
      if (host && canvas.parentNode !== host) {
        host.appendChild(canvas);
      }
      if (host && video.parentNode !== host) {
        host.appendChild(video);
      }
      if (host && touch.parentNode !== host) {
        host.appendChild(touch);
      }
    }
  }, [modalOpen]);

  /**
   * Close the enlarged modal view.
   */
  const onCloseModal = (): void => {
    setModalOpen(false);
  };

  /**
   * Open the enlarged modal view.
   */
  const openModalView = (): void => {
    setModalOpen(true);
  };

  const titleNode = (
    <div className="flex mb-2 w-full">
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">
        {t("remote.emulator")}
      </h2>
      <div className="flex grow">
        <SlideOutButton width={400} className="ml-4" icon={<List className="h-5 w-5" />}>
          <div className="flex grow">
            <div className="ml-2 w-px bg-slate-400 opacity-60" />
            <CButton
              onMouseDown={btnTrigger("power", 0)}
              onMouseUp={btnTrigger("power", 1)}
              className="ml-2 w-8 h-8"
              variant="secondary"
            >
              <Power size={20} className="rounded w-4 h-4 -translate-x-2" />
            </CButton>
            <CButton
              onMouseDown={btnTrigger("vol_dn", 0)}
              onMouseUp={btnTrigger("vol_dn", 1)}
              className="ml-2 w-8 h-8"
              variant="secondary"
            >
              <Volume1 size={20} className="rounded w-4 h-4 -translate-x-2" />
            </CButton>
            <CButton
              onMouseDown={btnTrigger("vol_up", 0)}
              onMouseUp={btnTrigger("vol_up", 1)}
              className="ml-2 w-8 h-8"
              variant="secondary"
            >
              <Volume2 size={20} className="rounded w-4 h-4 -translate-x-2" />
            </CButton>
            <CButton
              onMouseDown={btnTrigger("back", 0)}
              onMouseUp={btnTrigger("back", 1)}
              className="ml-2 w-8 h-8"
              variant="secondary"
            >
              <Play size={20} className="rounded w-4 h-4 -translate-x-2 scale-x-[-1]" />
            </CButton>
            <CButton
              onMouseDown={btnTrigger("home", 0)}
              onMouseUp={btnTrigger("home", 1)}
              className="ml-2 w-8 h-8"
              variant="secondary"
            >
              <Circle size={20} className="rounded w-4 h-4 -translate-x-2" />
            </CButton>
            <CButton
              onMouseDown={btnTrigger("switch", 0)}
              onMouseUp={btnTrigger("switch", 1)}
              className="ml-2 w-8 h-8"
              variant="secondary"
            >
              <Squircle size={20} className="rounded w-4 h-4 -translate-x-2" />
            </CButton>
            <CButton onClick={screenshot} className="ml-2 w-8 h-8" variant="secondary">
              <Camera size={20} className="rounded w-4 h-4 -translate-x-2" />
            </CButton>
            <SwitchButton
              onChange={toggleKeyboard}
              checked={keyListenStatus}
              className="ml-2 w-8! h-8! p-0!"
            >
              <Keyboard size={20} className="rounded w-4! h-4! translate-x-2" />
            </SwitchButton>
          </div>
        </SlideOutButton>
      </div>
    </div>
  );

  return (
    <div className="absolute bg-black w-64 h-36 right-5 top-3 rounded-xl m-4 overflow-hidden border-2 border-gray-500 z-10">
      {connectionState === ConnectionStatus.connected && (
        <div
          onClick={openModalView}
          className="absolute h-full w-full hover:bg-[#000000]/30 hover:backdrop-blur-[3px] transition z-3"
        >
          <div className="absolute group/outer w-full h-full flex cursor-pointer z-10">
            <CornerBox size={40} cornerSize={15} borderWidth={3} expand={8} className="m-auto" />
          </div>
        </div>
      )}

      {connectionState === ConnectionStatus.connecting && (
        <div className="absolute w-full h-full z-3 bg-[#000000]/30">
          <div className="flex flex-col h-full items-center justify-center text-white">
            <Loader2 className="animate-spin h-10 w-10 mb-2" />
            <div ref={statusRef} className="text-xs text-white z-10">
              {t("remote.connecting")}
            </div>
          </div>
        </div>
      )}

      <div ref={canvasHostRef} className="w-full h-full" />

      <Modal isOpen={modalOpen} title="" titleNode={titleNode} onClose={onCloseModal} width={95}>
        <div className="relative w-full max-w-full select-none font-mono">
          {showStatus && (
            <div className="absolute text-white right-0 m-2 py-2 px-4 bg-slate-800/70 rounded-lg backdrop-blur-[2px] pointer-events-none z-2 grid grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-1 [font-variant-numeric:tabular-nums]">
              <span className="text-right">{t("remote.inputBytes")}:</span>
              <span className="text-right min-w-22.5">{quality.prettyBytes}</span>
              <span>{t("remote.avg")}:</span>
              <span className="text-right min-w-22.5">{quality.prettyAvgBytes}/s</span>

              <span className="text-right">{t("remote.padInput")}:</span>
              <span className="text-right min-w-15">{quality.padInput}</span>
              <span className="text-right">{t("remote.avg")}:</span>
              <span className="text-right min-w-15">{quality.padAvgInput}</span>

              <span className="text-right">{t("remote.padDropped")}:</span>
              <span className="text-right min-w-15">{quality.padDropped}</span>
              <span>{t("remote.avg")}:</span>
              <span className="text-right min-w-15">{quality.padAvgDropped}</span>

              <span className="text-right">{t("remote.padDecoded")}:</span>
              <span className="text-right min-w-15">{quality.padDecoded}</span>
              <span>{t("remote.avg")}:</span>
              <span className="text-right min-w-15">{quality.padAvgDecoded}</span>
            </div>
          )}
          <div
            id="remote-ctrl-mount"
            className="max-h-[80vh] w-full aspect-video bg-black overflow-hidden"
          />
        </div>

        <Accordion
          className="bg-white border dark:border-none dark:bg-slate-600/50 px-5 py-0 rounded-sm mt-2"
          type="single"
          collapsible
        >
          <AccordionItem value="item-1">
            <AccordionTrigger>
              <Settings className="h-4 w-4 opacity-70" />
              <span>{t("remote.advanced")}</span>
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-2">
              <div className="flex gap-2 p-2">
                <FormInput
                  value={clipBoardText}
                  onChange={(e) => setClipBoardText(e.target.value)}
                  className="grow"
                ></FormInput>
                <CButton onClick={setClipBoard}>{t("remote.setClipboard")}</CButton>
                <CButton onClick={getClipBoard}>{t("remote.getClipboard")}</CButton>
              </div>
              <div className="flex gap-2">
                <div className="flex gap-2 grow items-end">
                  <FormInput
                    className="grow"
                    type="number"
                    label={t("remote.width")}
                    value={maxWidth}
                    onChange={(e) => setValue(setMaxWidth, e)}
                  ></FormInput>
                </div>
                <div className="flex gap-2 grow items-end">
                  <FormInput
                    className="grow"
                    type="number"
                    label={t("remote.height")}
                    value={maxHeight}
                    onChange={(e) => setValue(setMaxHeight, e)}
                  ></FormInput>
                </div>
                <div className="flex gap-2 grow items-end">
                  <FormInput
                    className="grow"
                    type="number"
                    label={t("remote.fps")}
                    value={maxFPS}
                    onChange={(e) => setValue(setMaxFPS, e)}
                  ></FormInput>
                </div>
                <div className="flex gap-2 grow items-end">
                  <FormInput
                    className="grow"
                    type="number"
                    label={t("remote.iframe")}
                    value={iFrameRate}
                    onChange={(e) => setValue(setIFrameRate, e)}
                  ></FormInput>
                </div>
                <div className="flex gap-2 grow items-end">
                  <FormInput
                    className="grow"
                    type="number"
                    label={t("remote.bitrate")}
                    value={bitRate}
                    onChange={(e) => setValue(setBitRate, e)}
                  ></FormInput>
                </div>
              </div>
              <div className="flex gap-2">
                <SwitchButton className="grow" checked={showStatus} onChange={toggleShowStatus}>
                  {t("remote.showStatus")}
                </SwitchButton>
                <CButton className="grow" onClick={saveSettings}>
                  {t("remote.saveAndApply")}
                </CButton>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Modal>
    </div>
  );
};
