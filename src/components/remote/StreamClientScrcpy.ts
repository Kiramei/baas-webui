import { DataUtil, EventMap, TypedEmitter, VideoSettings } from "./CommonUtil";
import { BasePlayer, PlayerClass } from "./player/BasePlayer";

import {
  ControlMessage,
  DeviceMessage,
  CommandControlMessage,
  KeyCodeControlMessage,
} from "./MessageCenter";
import {
  InteractionHandler,
  InteractionHandlerListener,
  KeyEventListener,
  KeyInputHandler,
} from "./InteractionHandler";

import { Size, DisplayInfo, ScreenInfo } from "./GeometryInfo";
import { KeyEvent } from "@/components/remote/KeySpaceMap.ts";

type StartParams = {
  udid: string;
  playerName?: string;
  player?: BasePlayer;
  fitToScreen?: boolean;
  videoSettings?: VideoSettings;
};

const DEVICE_NAME_FIELD_LENGTH = 64;
const MAGIC_BYTES_INITIAL = DataUtil.stringToUtf8ByteArray("scrcpy_initial");

export enum ACTION {
  PROXY_WS = "proxy-ws",
  STREAM_SCRCPY = "stream",
}

export type ClientsStats = {
  deviceName: string;
  clientId: number;
};

export type DisplayCombinedInfo = {
  displayInfo: DisplayInfo;
  videoSettings?: VideoSettings;
  screenInfo?: ScreenInfo;
  connectionCount: number;
};

interface StreamReceiverEvents {
  video: ArrayBuffer;
  deviceMessage: DeviceMessage;
  displayInfo: DisplayCombinedInfo[];
  clientsStats: ClientsStats;
  encoders: string[];
  connected: void;
  disconnected: CloseEvent;
}

interface ParamsBase {
  action: string;
  useProxy?: boolean;
  secure?: boolean;
  hostname?: string;
  port?: number;
  pathname?: string;
}

interface ParamsStream extends ParamsBase {
  udid: string;
  player: string;
}

export interface ParamsStreamScrcpy extends ParamsStream {
  action: ACTION.STREAM_SCRCPY;
  ws: string;
  fitToScreen?: boolean;
  videoSettings?: VideoSettings;
}

export const BTN_FUNC_MAP = {
  "power": KeyEvent.KEYCODE_POWER,
  "vol_up": KeyEvent.KEYCODE_VOLUME_UP,
  "vol_dn": KeyEvent.KEYCODE_VOLUME_DOWN,
  "back": KeyEvent.KEYCODE_BACK,
  "home": KeyEvent.KEYCODE_HOME,
  "switch": KeyEvent.KEYCODE_APP_SWITCH,
};

export class BaseClient<P extends ParamsBase, TE extends EventMap> extends TypedEmitter<TE> {
  protected title = "BaseClient";
  protected params: P;

  protected constructor(params: P) {
    super();
    this.params = params;
  }

  public static parseParameters(query: URLSearchParams): ParamsBase {
    const action = DataUtil.parseStringEnv(query.get("action"));
    if (!action) {
      throw TypeError("Invalid action");
    }
    return {
      action: action,
      useProxy: DataUtil.parseBooleanEnv(query.get("useProxy")),
      secure: DataUtil.parseBooleanEnv(query.get("secure")),
      hostname: DataUtil.parseStringEnv(query.get("hostname")),
      port: DataUtil.parseIntEnv(query.get("port")),
      pathname: DataUtil.parseStringEnv(query.get("pathname")),
    };
  }
}

export abstract class ManagerClient<P extends ParamsBase, TE extends EventMap> extends BaseClient<
  P,
  TE
> {
  public static ACTION = "unknown";
  protected readonly action?: string;
  protected url: URL;
  protected ws?: WebSocket;

  protected constructor(params: P) {
    super(params);
    this.action = DataUtil.parseStringEnv(params.action);
    this.url = this.buildWebSocketUrl();
  }

  protected openNewConnection(): WebSocket {
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      this.ws.close();
      delete this.ws;
    }
    const url = this.url.toString();
    const ws = new WebSocket(url);
    ws.addEventListener("open", this.onSocketOpen.bind(this));
    ws.addEventListener("message", this.onSocketMessage.bind(this));
    ws.addEventListener("close", this.onSocketClose.bind(this));
    this.ws = ws;
    return this.ws;
  }

  protected buildWebSocketUrl(): URL {
    const directUrl = this.buildDirectWebSocketUrl();
    if (this.params.useProxy) {
      return this.wrapInProxy(directUrl);
    }
    return directUrl;
  }

  protected buildDirectWebSocketUrl(): URL {
    const { hostname, port, secure, action } = this.params;
    const pathname = this.params.pathname ?? location.pathname;
    let urlString: string;
    if (typeof hostname === "string" && typeof port === "number") {
      const protocol = secure ? "wss:" : "ws:";
      urlString = `${protocol}//${hostname}:${port}${pathname}`;
    } else {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";

      // location.host includes hostname and port
      urlString = `${protocol}${location.host}${pathname}`;
    }
    const directUrl = new URL(urlString);
    if (action) {
      directUrl.searchParams.set("action", action);
    }
    return directUrl;
  }

  protected wrapInProxy(directUrl: URL): URL {
    const localProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    const localUrl = new URL(`${localProtocol}//${location.host}`);
    localUrl.searchParams.set("action", ACTION.PROXY_WS);
    localUrl.searchParams.set("ws", directUrl.toString());
    return localUrl;
  }

  protected abstract onSocketOpen(event: Event): void;
  protected abstract onSocketMessage(event: MessageEvent): void;
  protected abstract onSocketClose(event: CloseEvent): void;
}

export class StreamReceiver<P extends ParamsStream> extends ManagerClient<
  ParamsStream,
  StreamReceiverEvents
> {
  private events: ControlMessage[] = [];
  private encodersSet: Set<string> = new Set<string>();
  private clientId = -1;
  private deviceName = "";
  private readonly displayInfoMap: Map<number, DisplayInfo> = new Map();
  private readonly connectionCountMap: Map<number, number> = new Map();
  private readonly screenInfoMap: Map<number, ScreenInfo> = new Map();
  private readonly videoSettingsMap: Map<number, VideoSettings> = new Map();
  private hasInitialInfo = false;

  constructor(params: P) {
    super(params);
    this.openNewConnection();
    if (this.ws) {
      this.ws.binaryType = "arraybuffer";
    }
  }

  private static EqualArrays(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0, l = a.length; i < l; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  public sendEvent(event: ControlMessage): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      this.ws.send(event.toBuffer());
    } else {
      this.events.push(event);
    }
  }

  public getEncoders(): string[] {
    return Array.from(this.encodersSet.values());
  }

  public triggerInitialInfoEvents(): void {
    if (this.hasInitialInfo) {
      const encoders = this.getEncoders();
      this.emit("encoders", encoders);
      const { clientId, deviceName } = this;
      this.emit("clientsStats", { clientId, deviceName });
      const infoArray: DisplayCombinedInfo[] = [];
      this.displayInfoMap.forEach((displayInfo: DisplayInfo, displayId: number) => {
        const connectionCount = this.connectionCountMap.get(displayId) || 0;
        infoArray.push({
          displayInfo,
          videoSettings: this.videoSettingsMap.get(displayId),
          screenInfo: this.screenInfoMap.get(displayId),
          connectionCount,
        });
      });
      this.emit("displayInfo", infoArray);
    }
  }

  public getDisplayInfo(displayId: number): DisplayInfo | undefined {
    return this.displayInfoMap.get(displayId);
  }

  protected buildDirectWebSocketUrl(): URL {
    const localUrl = super.buildDirectWebSocketUrl();
    localUrl.searchParams.set("udid", this.params.udid);
    return localUrl;
  }

  protected onSocketClose(ev: CloseEvent): void {
    console.log(`WS closed: ${ev.reason}`);
    this.emit("disconnected", ev);
  }

  protected onSocketMessage(event: MessageEvent): void {
    if (event.data instanceof ArrayBuffer) {
      // works only because MAGIC_BYTES_INITIAL and MAGIC_BYTES_MESSAGE have same length
      if (event.data.byteLength > MAGIC_BYTES_INITIAL.length) {
        const magicBytes = new Uint8Array(event.data, 0, MAGIC_BYTES_INITIAL.length);
        if (StreamReceiver.EqualArrays(magicBytes, MAGIC_BYTES_INITIAL)) {
          this.handleInitialInfo(event.data);
          return;
        }
        if (StreamReceiver.EqualArrays(magicBytes, DeviceMessage.MAGIC_BYTES_MESSAGE)) {
          const message = DeviceMessage.fromBuffer(event.data);
          this.emit("deviceMessage", message);
          return;
        }
      }

      this.emit("video", new Uint8Array(event.data));
    }
  }

  protected onSocketOpen(): void {
    this.emit("connected", void 0);
    let e = this.events.shift();
    while (e) {
      this.sendEvent(e);
      e = this.events.shift();
    }
  }

  private handleInitialInfo(data: ArrayBuffer): void {
    let offset = MAGIC_BYTES_INITIAL.length;
    let nameBytes = new Uint8Array(data, offset, DEVICE_NAME_FIELD_LENGTH);
    offset += DEVICE_NAME_FIELD_LENGTH;
    let rest: Buffer = Buffer.from(new Uint8Array(data, offset));
    const displaysCount = rest.readInt32BE(0);
    this.displayInfoMap.clear();
    this.connectionCountMap.clear();
    this.screenInfoMap.clear();
    this.videoSettingsMap.clear();
    rest = rest.subarray(4);
    for (let i = 0; i < displaysCount; i++) {
      const displayInfoBuffer = rest.subarray(0, DisplayInfo.BUFFER_LENGTH);
      const displayInfo = DisplayInfo.fromBuffer(displayInfoBuffer);
      const { displayId } = displayInfo;
      this.displayInfoMap.set(displayId, displayInfo);
      rest = rest.subarray(DisplayInfo.BUFFER_LENGTH);
      this.connectionCountMap.set(displayId, rest.readInt32BE(0));
      rest = rest.subarray(4);
      const screenInfoBytesCount = rest.readInt32BE(0);
      rest = rest.subarray(4);
      if (screenInfoBytesCount) {
        this.screenInfoMap.set(
          displayId,
          ScreenInfo.fromBuffer(rest.subarray(0, screenInfoBytesCount))
        );
        rest = rest.subarray(screenInfoBytesCount);
      }
      const videoSettingsBytesCount = rest.readInt32BE(0);
      rest = rest.subarray(4);
      if (videoSettingsBytesCount) {
        this.videoSettingsMap.set(
          displayId,
          VideoSettings.fromBuffer(rest.subarray(0, videoSettingsBytesCount))
        );
        rest = rest.subarray(videoSettingsBytesCount);
      }
    }
    this.encodersSet.clear();
    const encodersCount = rest.readInt32BE(0);
    rest = rest.subarray(4);
    for (let i = 0; i < encodersCount; i++) {
      const nameLength = rest.readInt32BE(0);
      rest = rest.subarray(4);
      const nameBytes = rest.subarray(0, nameLength);
      rest = rest.subarray(nameLength);
      const name = DataUtil.utf8ByteArrayToString(nameBytes);
      this.encodersSet.add(name);
    }
    this.clientId = rest.readInt32BE(0);
    nameBytes = DataUtil.filterTrailingZeroes(nameBytes);
    this.deviceName = DataUtil.utf8ByteArrayToString(nameBytes);
    this.hasInitialInfo = true;
    this.triggerInitialInfoEvents();
  }
}

export class StreamReceiverScrcpy extends StreamReceiver<ParamsStreamScrcpy> {
  public static parseParameters(params: URLSearchParams): ParamsStreamScrcpy {
    const typedParams = super.parseParameters(params);
    const { action } = typedParams;
    if (action !== ACTION.STREAM_SCRCPY) {
      throw Error("Incorrect action");
    }
    return {
      ...typedParams,
      action,
      udid: DataUtil.parseString(params, "udid", true),
      ws: DataUtil.parseString(params, "ws", true),
      player: DataUtil.parseString(params, "player", true),
    };
  }
  protected buildDirectWebSocketUrl(): URL {
    return new URL((this.params as ParamsStreamScrcpy).ws);
  }
}

export class StreamClientScrcpy
  extends BaseClient<ParamsStreamScrcpy, never>
  implements KeyEventListener, InteractionHandlerListener
{
  public static ACTION = "stream";
  private static players: Map<string, PlayerClass> = new Map<string, PlayerClass>();

  private controlButtons?: HTMLElement;
  private deviceName = "";
  private clientsCount = -1;
  private joinedStream = false;
  private requestedVideoSettings?: VideoSettings;
  private touchHandler?: InteractionHandler;
  private player?: BasePlayer;
  private onClipBoxReceived?: (text: string) => void;
  private fitToScreen?: boolean;
  private readonly streamReceiver: StreamReceiverScrcpy;

  protected constructor(
    params: ParamsStreamScrcpy,
    streamReceiver?: StreamReceiverScrcpy,
    player?: BasePlayer,
    fitToScreen?: boolean,
    videoSettings?: VideoSettings
  ) {
    super(params);
    if (streamReceiver) {
      this.streamReceiver = streamReceiver;
    } else {
      this.streamReceiver = new StreamReceiverScrcpy(this.params);
    }

    const { udid, player: playerName } = this.params;
    this.startStream({ udid, player, playerName, fitToScreen, videoSettings });
  }

  public static registerPlayer(playerClass: PlayerClass): void {
    if (playerClass.isSupported()) {
      this.players.set(playerClass.playerFullName, playerClass);
    }
  }

  public static createPlayer(
    playerName: string,
    udid: string,
    displayInfo?: DisplayInfo
  ): BasePlayer | undefined {
    const playerClass = this.getPlayerClass(playerName);
    if (!playerClass) {
      return;
    }
    return new playerClass(udid, displayInfo);
  }

  public static getFitToScreen(
    playerName: string,
    udid: string,
    displayInfo?: DisplayInfo
  ): boolean {
    const playerClass = this.getPlayerClass(playerName);
    if (!playerClass) {
      return false;
    }
    return playerClass.getFitToScreenStatus(udid, displayInfo);
  }

  public static start(
    query: URLSearchParams | ParamsStreamScrcpy,
    streamReceiver?: StreamReceiverScrcpy,
    player?: BasePlayer,
    fitToScreen?: boolean,
    videoSettings?: VideoSettings
  ): StreamClientScrcpy {
    if (query instanceof URLSearchParams) {
      const params = StreamClientScrcpy.parseParameters(query);
      return new StreamClientScrcpy(params, streamReceiver, player, fitToScreen, videoSettings);
    }
    return new StreamClientScrcpy(query, streamReceiver, player, fitToScreen, videoSettings);
  }

  public static parseParameters(params: URLSearchParams): ParamsStreamScrcpy {
    const typedParams = super.parseParameters(params);
    const { action } = typedParams;
    if (action !== ACTION.STREAM_SCRCPY) {
      throw Error("Incorrect action");
    }
    return {
      ...typedParams,
      action,
      player: DataUtil.parseString(params, "player", true),
      udid: DataUtil.parseString(params, "udid", true),
      ws: DataUtil.parseString(params, "ws", true),
    };
  }

  private static getPlayerClass(playerName: string): PlayerClass | undefined {
    let playerClass: PlayerClass | undefined;
    for (const value of StreamClientScrcpy.players.values()) {
      if (value.playerFullName === playerName || value.playerCodeName === playerName) {
        playerClass = value;
      }
    }
    return playerClass;
  }

  private static createVideoSettingsWithBounds(old: VideoSettings, newBounds: Size): VideoSettings {
    return new VideoSettings({
      crop: old.crop,
      bitrate: old.bitrate,
      bounds: newBounds,
      maxFps: old.maxFps,
      iFrameInterval: old.iFrameInterval,
      sendFrameMeta: old.sendFrameMeta,
      lockedVideoOrientation: old.lockedVideoOrientation,
      displayId: old.displayId,
      codecOptions: old.codecOptions,
      encoderName: old.encoderName,
    });
  }

  public setOnClipBoxReceived = (func: (text: string) => void): void => {
    this.onClipBoxReceived = func;
  };

  public OnDeviceMessage = (message: DeviceMessage): void => {
    if (this.onClipBoxReceived && message.type === DeviceMessage.TYPE_CLIPBOARD) {
      this.onClipBoxReceived(message.getText());
    }
  };

  public onVideo = (data: ArrayBuffer): void => {
    if (!this.player) {
      return;
    }
    const STATE = BasePlayer.STATE;
    if (this.player.getState() === STATE.PAUSED) {
      this.player.play();
    }
    if (this.player.getState() === STATE.PLAYING) {
      this.player.pushFrame(new Uint8Array(data));
    }
  };

  public onClientsStats = (stats: ClientsStats): void => {
    this.deviceName = stats.deviceName;
  };

  public onDisplayInfo = (infoArray: DisplayCombinedInfo[]): void => {
    if (!this.player) {
      return;
    }
    let currentSettings = this.player.getVideoSettings();
    const displayId = currentSettings.displayId;
    const info = infoArray.find((value) => {
      return value.displayInfo.displayId === displayId;
    });
    if (!info) {
      return;
    }
    if (this.player.getState() === BasePlayer.STATE.PAUSED) {
      this.player.play();
    }
    const { videoSettings, screenInfo } = info;
    this.player.setDisplayInfo(info.displayInfo);
    if (typeof this.fitToScreen !== "boolean") {
      this.fitToScreen = this.player.getFitToScreenStatus();
    }
    if (this.fitToScreen) {
      const newBounds = this.getMaxSize();
      if (newBounds) {
        currentSettings = StreamClientScrcpy.createVideoSettingsWithBounds(
          currentSettings,
          newBounds
        );
        this.player.setVideoSettings(currentSettings, this.fitToScreen, false);
      }
    }
    if (!videoSettings || !screenInfo) {
      this.joinedStream = true;
      this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(currentSettings));
      return;
    }

    this.clientsCount = info.connectionCount;
    let min = VideoSettings.copy(videoSettings);
    const oldInfo = this.player.getScreenInfo();
    if (!screenInfo.equals(oldInfo)) {
      this.player.setScreenInfo(screenInfo);
    }

    if (!videoSettings.equals(currentSettings)) {
      this.applyNewVideoSettings(videoSettings, videoSettings.equals(this.requestedVideoSettings));
    }
    if (!oldInfo) {
      const bounds = currentSettings.bounds;
      const videoSize: Size = screenInfo.videoSize;
      const onlyOneClient = this.clientsCount === 0;
      const smallerThenCurrent =
        bounds && (bounds.width < videoSize.width || bounds.height < videoSize.height);
      if (onlyOneClient || smallerThenCurrent) {
        min = currentSettings;
      }
      const minBounds = currentSettings.bounds?.intersect(min.bounds);
      if (minBounds && !minBounds.equals(min.bounds)) {
        min = StreamClientScrcpy.createVideoSettingsWithBounds(min, minBounds);
      }
    }
    if (!min.equals(videoSettings) || !this.joinedStream) {
      this.joinedStream = true;
      this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(min));
    }
  };

  public onDisconnected = (): void => {
    this.streamReceiver.off("deviceMessage", this.OnDeviceMessage);
    this.streamReceiver.off("video", this.onVideo);
    this.streamReceiver.off("clientsStats", this.onClientsStats);
    this.streamReceiver.off("displayInfo", this.onDisplayInfo);
    this.streamReceiver.off("disconnected", this.onDisconnected);

    this.touchHandler?.release();
    this.touchHandler = undefined;
  };

  public startStream({ udid, player, playerName, videoSettings, fitToScreen }: StartParams): void {
    if (!udid) {
      throw Error(`Invalid udid value: "${udid}"`);
    }

    this.fitToScreen = fitToScreen;
    if (!player) {
      if (typeof playerName !== "string") {
        throw Error("Must provide BasePlayer instance or playerName");
      }
      let displayInfo: DisplayInfo | undefined;
      if (this.streamReceiver && videoSettings) {
        displayInfo = this.streamReceiver.getDisplayInfo(videoSettings.displayId);
      }
      const p = StreamClientScrcpy.createPlayer(playerName, udid, displayInfo);
      if (!p) {
        throw Error(`Unsupported player: "${playerName}"`);
      }
      if (typeof fitToScreen !== "boolean") {
        fitToScreen = StreamClientScrcpy.getFitToScreen(playerName, udid, displayInfo);
      }
      player = p;
    }
    this.player = player;
    this.setTouchListeners(player);

    if (!videoSettings) {
      videoSettings = player.getVideoSettings();
    }

    player.pause();

    if (fitToScreen) {
      const newBounds = this.getMaxSize();
      if (newBounds) {
        videoSettings = StreamClientScrcpy.createVideoSettingsWithBounds(videoSettings, newBounds);
      }
    }
    this.applyNewVideoSettings(videoSettings, false);

    const streamReceiver = this.streamReceiver;
    streamReceiver.on("deviceMessage", this.OnDeviceMessage);
    streamReceiver.on("video", this.onVideo);
    streamReceiver.on("clientsStats", this.onClientsStats);
    streamReceiver.on("displayInfo", this.onDisplayInfo);
    streamReceiver.on("disconnected", this.onDisconnected);
    console.log(player.getName(), udid);
  }

  public sendMessage(message: ControlMessage): void {
    this.streamReceiver.sendEvent(message);
  }

  public getDeviceName(): string {
    return this.deviceName;
  }

  public setHandleKeyboardEvents(enabled: boolean): void {
    if (enabled) {
      KeyInputHandler.addEventListener(this);
    } else {
      KeyInputHandler.removeEventListener(this);
    }
  }

  public onKeyEvent(event: KeyCodeControlMessage): void {
    this.sendMessage(event);
  }

  public sendNewVideoSetting(videoSettings: VideoSettings): void {
    this.requestedVideoSettings = videoSettings;
    this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(videoSettings));
  }

  public getMaxSize(): Size | undefined {
    if (!this.controlButtons) {
      return;
    }
    const body = document.body;
    const width = (body.clientWidth - this.controlButtons.clientWidth) & ~15;
    const height = body.clientHeight & ~15;
    return new Size(width, height);
  }

  private setTouchListeners(player: BasePlayer): void {
    if (this.touchHandler) {
      return;
    }
    this.touchHandler = new InteractionHandler(player, this);
  }

  private applyNewVideoSettings(videoSettings: VideoSettings, saveToStorage: boolean): void {
    let fitToScreen = false;

    if (videoSettings.bounds && videoSettings.bounds.equals(this.getMaxSize())) {
      fitToScreen = true;
    }
    if (this.player) {
      this.player.setVideoSettings(videoSettings, fitToScreen, saveToStorage);
    }
  }
}
