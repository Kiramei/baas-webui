import { BaseCanvasBasedPlayer } from "./BasePlayer";
import { VideoSettings } from "../CommonUtil";
import { Size, DisplayInfo } from "../GeometryInfo";
import YUVCanvas from "./vendor/h264-live-player/YUVCanvas";
import YUVWebGLCanvas from "./vendor/h264-live-player/YUVWebGLCanvas";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import * as AvcModule from "./vendor/Broadway/Decoder";
import Canvas from "./vendor/h264-live-player/Canvas";

const Avc = (AvcModule as any).default || AvcModule;

export class BroadwayPlayer extends BaseCanvasBasedPlayer {
  public static readonly storageKeyPrefix = "BroadwayDecoder";
  public static readonly playerFullName = "Broadway.js";
  // noinspection JSUnusedGlobalSymbols
  public static readonly playerCodeName = "broadway";
  public static readonly preferredVideoSettings: VideoSettings = new VideoSettings({
    lockedVideoOrientation: -1,
    bitrate: 524288,
    maxFps: 24,
    iFrameInterval: 5,
    bounds: new Size(480, 480),
    sendFrameMeta: false,
  });
  public readonly supportsScreenshot: boolean = true;
  protected canvas?: Canvas;
  private avc?: typeof Avc;

  constructor(
    udid: string,
    displayInfo?: DisplayInfo,
    name = BroadwayPlayer.playerFullName,
    protected tag: HTMLCanvasElement = BaseCanvasBasedPlayer.createElement(),
    protected touchableCanvas: HTMLCanvasElement = document.createElement("canvas")
  ) {
    super(udid, displayInfo, name, BroadwayPlayer.storageKeyPrefix, tag, touchableCanvas);
  }

  // noinspection JSUnusedGlobalSymbols
  public static isSupported(): boolean {
    return typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
  }

  public getPreferredVideoSetting(): VideoSettings {
    return BroadwayPlayer.preferredVideoSettings;
  }

  public getFitToScreenStatus(): boolean {
    return BroadwayPlayer.getFitToScreenStatus(this.udid, this.displayInfo);
  }

  // noinspection JSUnusedGlobalSymbols
  public loadVideoSettings(): VideoSettings {
    return BroadwayPlayer.loadVideoSettings(this.udid, this.displayInfo);
  }

  protected initCanvas(width: number, height: number): void {
    super.initCanvas(width, height);
    if (BaseCanvasBasedPlayer.hasWebGLSupport()) {
      this.canvas = new YUVWebGLCanvas(this.tag, new Size(width, height));
    } else {
      this.canvas = new YUVCanvas(this.tag, new Size(width, height));
    }
    if (!this.avc) {
      const wasmUrl = new URL("./vendor/Broadway/avc.wasm", import.meta.url).href;

      this.avc = new Avc({
        locateFile: (path: string) => {
          if (path.endsWith(".wasm")) {
            return wasmUrl;
          }
          return path;
        },
      });
    }
    this.avc.onPictureDecoded = (buffer: Uint8Array, width: number, height: number) => {
      this.onFrameDecoded(width, height, buffer);
    };
  }

  protected decode(data: Uint8Array): void {
    if (!this.avc) {
      return;
    }
    this.avc.decode(data);
  }
}
