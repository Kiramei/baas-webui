// /**
//  * H264 WebSocket Decoder (Annex-B → AVCC → WebCodecs)
//  *
//  * This implementation is designed for:
//  * - Low-latency streaming (compatible with Scrcpy)
//  * - Robust decoder lifecycle handling
//  * - Strict compliance with WebCodecs expectations
//  *
//  * Key guarantees:
//  * - No empty/invalid NAL units are passed to decoder
//  * - Decoder is only fed after SPS/PPS + IDR are available
//  * - Decoder is reset safely on failure
//  */
//
// type NalUnit = Uint8Array;
//
// export class H264WebSocketDecoder {
//   private canvas: HTMLCanvasElement;
//   private ctx: CanvasRenderingContext2D;
//
//   private decoder: VideoDecoder | null = null;
//   private configured = false;
//
//   private latestSPS: NalUnit | null = null;
//   private latestPPS: NalUnit | null = null;
//
//   private waitingForKey = true;
//
//   constructor(canvas: HTMLCanvasElement) {
//     const ctx = canvas.getContext("2d", {alpha: false});
//     if (!ctx) {
//       throw new Error("Failed to acquire 2D context");
//     }
//
//     this.canvas = canvas;
//     this.ctx = ctx;
//   }
//
//   /**
//    * Resize canvas only when necessary to avoid redundant layout work
//    */
//   private resizeCanvas(width: number, height: number): void {
//     if (this.canvas.width !== width || this.canvas.height !== height) {
//       this.canvas.width = width;
//       this.canvas.height = height;
//     }
//   }
//
//   /**
//    * Split Annex-B byte stream into NAL units
//    *
//    * IMPORTANT:
//    * - Filters out empty NALs caused by consecutive start codes
//    * - Returns raw NAL payload (without start code)
//    */
//   private splitAnnexBNals(buffer: ArrayBuffer): NalUnit[] {
//     const bytes = new Uint8Array(buffer);
//     const starts: number[] = [];
//
//     for (let i = 0; i < bytes.length - 3; i++) {
//       if (
//         bytes[i] === 0 &&
//         bytes[i + 1] === 0 &&
//         (
//           bytes[i + 2] === 1 ||
//           (bytes[i + 2] === 0 && bytes[i + 3] === 1)
//         )
//       ) {
//         starts.push(i);
//       }
//     }
//
//     if (starts.length === 0) return [];
//
//     const nals: NalUnit[] = [];
//
//     for (let i = 0; i < starts.length; i++) {
//       const start = starts[i];
//       const end = i + 1 < starts.length ? starts[i + 1] : bytes.length;
//
//       let startCodeLength = 3;
//       if (bytes[start + 2] === 0 && bytes[start + 3] === 1) {
//         startCodeLength = 4;
//       }
//
//       const nal = bytes.slice(start + startCodeLength, end);
//
//       // Filter invalid / empty NALs
//       if (nal.length === 0) continue;
//
//       const type = nal[0] & 0x1f;
//       if (type <= 0 || type > 12) continue;
//
//       nals.push(nal);
//     }
//
//     return nals;
//   }
//
//   /**
//    * Extract NAL unit type
//    */
//   private getNalType(nal: NalUnit): number {
//     return nal.length > 0 ? (nal[0] & 0x1f) : -1;
//   }
//
//   /**
//    * Convert Annex-B NAL units into AVCC format
//    *
//    * AVCC = [length][NAL][length][NAL]...
//    */
//   private annexBToAvcc(nals: NalUnit[]): Uint8Array {
//     let total = 0;
//     for (const nal of nals) {
//       total += 4 + nal.length;
//     }
//
//     const out = new Uint8Array(total);
//     let offset = 0;
//
//     for (const nal of nals) {
//       const len = nal.length;
//
//       out[offset] = (len >>> 24) & 0xff;
//       out[offset + 1] = (len >>> 16) & 0xff;
//       out[offset + 2] = (len >>> 8) & 0xff;
//       out[offset + 3] = len & 0xff;
//
//       offset += 4;
//       out.set(nal, offset);
//       offset += len;
//     }
//
//     return out;
//   }
//
//   /**
//    * Build AVCDecoderConfigurationRecord from SPS/PPS
//    *
//    * Required by WebCodecs when feeding AVCC stream
//    */
//   private buildConfigRecord(sps: NalUnit, pps: NalUnit): Uint8Array {
//     const size =
//       7 +
//       2 + sps.length +
//       1 +
//       2 + pps.length;
//
//     const out = new Uint8Array(size);
//     let o = 0;
//
//     out[o++] = 0x01;
//     out[o++] = sps[1];
//     out[o++] = sps[2];
//     out[o++] = sps[3];
//
//     out[o++] = 0xff;
//     out[o++] = 0xe1;
//
//     out[o++] = (sps.length >>> 8) & 0xff;
//     out[o++] = sps.length & 0xff;
//     out.set(sps, o);
//     o += sps.length;
//
//     out[o++] = 0x01;
//
//     out[o++] = (pps.length >>> 8) & 0xff;
//     out[o++] = pps.length & 0xff;
//     out.set(pps, o);
//
//     return out;
//   }
//
//   /**
//    * Build codec string from SPS
//    */
//   private codecFromSPS(sps: NalUnit): string {
//     return `avc1.${sps[1].toString(16).padStart(2, "0")}${
//       sps[2].toString(16).padStart(2, "0")
//     }${sps[3].toString(16).padStart(2, "0")}`;
//   }
//
//   /**
//    * Ensure decoder instance exists
//    */
//   private ensureDecoder(): void {
//     if (this.decoder) return;
//
//     this.decoder = new VideoDecoder({
//       output: (frame) => {
//         this.resizeCanvas(frame.displayWidth, frame.displayHeight);
//         this.ctx.drawImage(frame, 0, 0);
//         frame.close();
//       },
//       error: (e) => {
//         console.error("Decoder error:", e);
//         this.resetDecoder();
//       },
//     });
//   }
//
//   /**
//    * Reset decoder safely
//    */
//   private resetDecoder(): void {
//     if (this.decoder) {
//       try {
//         this.decoder.close();
//       } catch {
//       }
//     }
//
//     this.decoder = null;
//     this.configured = false;
//     this.waitingForKey = true;
//   }
//
//   /**
//    * Configure decoder if SPS/PPS are available
//    */
//   private configureIfNeeded(): void {
//     if (this.configured || !this.latestSPS || !this.latestPPS) return;
//
//     this.ensureDecoder();
//
//     const codec = this.codecFromSPS(this.latestSPS);
//     const description = this.buildConfigRecord(this.latestSPS, this.latestPPS);
//
//     this.decoder!.configure({
//       codec,
//       description,
//       optimizeForLatency: true,
//       hardwareAcceleration: "prefer-hardware",
//     });
//
//     this.configured = true;
//     console.log("Decoder configured:", codec);
//   }
//
//   /**
//    * Decode incoming H264 Frame
//    *
//    * Frame format:
//    * [raw Annex-B H264 bytes]
//    */
//   public decode(frameBytes: Uint8Array, is_key: boolean, pts: Number): void {
//
//     const nals = this.splitAnnexBNals(
//       frameBytes.buffer.slice(
//         frameBytes.byteOffset,
//         frameBytes.byteOffset + frameBytes.byteLength
//       )
//     );
//
//     let hasIDR = false;
//
//     for (const nal of nals) {
//       const t = this.getNalType(nal);
//
//       if (t === 7) this.latestSPS = nal;
//       else if (t === 8) this.latestPPS = nal;
//       else if (t === 5) {
//         hasIDR = true;
//       }
//     }
//
//     this.configureIfNeeded();
//     if (!this.configured) return;
//
//     if (this.waitingForKey) {
//       if (!hasIDR && !is_key) {
//         return;
//       }
//       this.waitingForKey = false;
//     }
//
//     const avcc = this.annexBToAvcc(nals);
//
//     const chunk = new EncodedVideoChunk({
//       type: hasIDR || is_key ? "key" : "delta",
//       timestamp: Number(pts),
//       data: avcc,
//     });
//
//     try {
//       this.decoder!.decode(chunk);
//     } catch (e) {
//       console.error("decode failed:", e);
//       this.resetDecoder();
//     }
//   }
//
//   public close(): void {
//     this.decoder?.close();
//   }
// }


/**
 * Unified H.264 WebSocket decoder facade.
 *
 * External contract intentionally preserved:
 * - constructor(canvas, options?)
 * - decode(frameBytes, is_key, pts)
 * - close()
 *
 * Internal architecture:
 * - AbstractH264DecoderBackend: shared H.264 parsing/state management
 * - WebCodecsH264DecoderBackend: low-latency primary backend
 * - MSEH264DecoderBackend: compatibility fallback backend
 *
 * IMPORTANT:
 * MSE cannot consume raw Annex-B H.264 directly.
 * It requires fragmented MP4 (fMP4) segments.
 * Therefore, the MSE backend depends on a muxer/packager interface that
 * converts Annex-B access units into fMP4 initialization/media segments.
 */

type NalUnit = Uint8Array;
type TimestampLike = number | Number;

type DecoderBackendKind = "auto" | "webcodecs" | "mse";

interface H264DecoderOptions {
  /**
   * Preferred backend selection strategy.
   *
   * - "auto": prefer WebCodecs, fall back to MSE
   * - "webcodecs": force WebCodecs
   * - "mse": force MSE
   */
  backend?: DecoderBackendKind;

  /**
   * Whether the hidden MSE <video> element should be muted.
   * Muted playback is usually required for autoplay to succeed.
   */
  muted?: boolean;
}

interface H264AccessUnit {
  /**
   * Original H.264 access unit as received from transport.
   * Expected to contain raw Annex-B bytes.
   */
  rawAnnexB: Uint8Array;

  /**
   * Parsed raw NAL payloads with start codes removed.
   */
  nals: NalUnit[];

  /**
   * Whether this access unit contains an IDR NAL.
   */
  hasIDR: boolean;

  /**
   * Whether transport explicitly marked the frame as key.
   */
  isKey: boolean;

  /**
   * Presentation timestamp in microseconds or whichever timescale your
   * surrounding pipeline already uses consistently.
   */
  pts: number;
}
/**
 * Abstract base class shared by all H.264 decoder backends.
 *
 * Responsibilities centralized here:
 * - Canvas ownership and drawing context acquisition
 * - Annex-B NAL splitting
 * - NAL type extraction
 * - Shared stream state (latest SPS/PPS, keyframe gating)
 * - Outer decode() contract
 *
 * Responsibilities intentionally delegated to subclasses:
 * - Actual decode path implementation
 * - Backend-specific lifecycle handling
 */
abstract class AbstractH264DecoderBackend {
  public type: "webcodecs" | "mse" | undefined;

  protected readonly canvas: HTMLCanvasElement;
  protected readonly ctx: CanvasRenderingContext2D;

  /**
   * Latest parameter sets observed in stream.
   * Backends may use these for configuration or MIME derivation.
   */
  protected latestSPS: NalUnit | null = null;
  protected latestPPS: NalUnit | null = null;

  /**
   * Decoding must not start from inter frames, otherwise corruption is likely.
   */
  protected waitingForKey = true;

  protected closed = false;

  public constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", {alpha: false});
    if (!ctx) {
      throw new Error("Failed to acquire 2D context");
    }

    this.canvas = canvas;
    this.ctx = ctx;
  }

  /**
   * Public entry point.
   *
   * This method preserves the original caller-facing contract while routing
   * internally to a backend-specific implementation.
   */
  public decode(frameBytes: Uint8Array, is_key: boolean, pts: TimestampLike): void {
    if (this.closed) {
      return;
    }

    const accessUnit = this.buildAccessUnit(frameBytes, is_key, Number(pts));
    this.handleAccessUnit(accessUnit);
  }

  /**
   * Subclasses implement the actual decoding/presentation path here.
   */
  protected abstract handleAccessUnit(accessUnit: H264AccessUnit): void;

  /**
   * Subclasses may override if they need extra teardown work.
   */
  public close(): void {
    this.closed = true;
  }

  /**
   * Resize canvas only when dimensions actually change.
   * This avoids unnecessary layout churn.
   */
  protected resizeCanvas(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /**
   * Parse one transport frame into a normalized access-unit object.
   */
  private buildAccessUnit(frameBytes: Uint8Array, isKey: boolean, pts: number): H264AccessUnit {
    const nals = this.splitAnnexBNals(
      frameBytes.buffer.slice(
        frameBytes.byteOffset,
        frameBytes.byteOffset + frameBytes.byteLength,
      ),
    );

    let hasIDR = false;

    for (const nal of nals) {
      const type = this.getNalType(nal);

      if (type === 7) {
        this.latestSPS = nal;
      } else if (type === 8) {
        this.latestPPS = nal;
      } else if (type === 5) {
        hasIDR = true;
      }
    }

    return {
      rawAnnexB: frameBytes,
      nals,
      hasIDR,
      isKey,
      pts,
    };
  }

  /**
   * Split Annex-B byte stream into raw NAL payloads.
   *
   * Guarantees:
   * - Start codes are removed from output
   * - Empty NALs are discarded
   * - Obviously invalid type values are filtered out
   */
  protected splitAnnexBNals(buffer: ArrayBuffer): NalUnit[] {
    const bytes = new Uint8Array(buffer);
    const starts: number[] = [];

    for (let i = 0; i < bytes.length - 3; i++) {
      if (
        bytes[i] === 0 &&
        bytes[i + 1] === 0 &&
        (bytes[i + 2] === 1 || (bytes[i + 2] === 0 && bytes[i + 3] === 1))
      ) {
        starts.push(i);
      }
    }

    if (starts.length === 0) {
      return [];
    }

    const nals: NalUnit[] = [];

    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];
      const end = i + 1 < starts.length ? starts[i + 1] : bytes.length;

      let startCodeLength = 3;
      if (bytes[start + 2] === 0 && bytes[start + 3] === 1) {
        startCodeLength = 4;
      }

      const nal = bytes.slice(start + startCodeLength, end);
      if (nal.length === 0) {
        continue;
      }

      const type = nal[0] & 0x1f;
      if (type <= 0 || type > 12) {
        continue;
      }

      nals.push(nal);
    }

    return nals;
  }

  /**
   * Extract H.264 NAL unit type from one raw NAL payload.
   */
  protected getNalType(nal: NalUnit): number {
    return nal.length > 0 ? (nal[0] & 0x1f) : -1;
  }

  /**
   * Convert raw NAL payloads into AVCC format:
   * [length][NAL][length][NAL]...
   */
  protected annexBToAvcc(nals: NalUnit[]): Uint8Array {
    let total = 0;
    for (const nal of nals) {
      total += 4 + nal.length;
    }

    const out = new Uint8Array(total);
    let offset = 0;

    for (const nal of nals) {
      const len = nal.length;

      out[offset] = (len >>> 24) & 0xff;
      out[offset + 1] = (len >>> 16) & 0xff;
      out[offset + 2] = (len >>> 8) & 0xff;
      out[offset + 3] = len & 0xff;

      offset += 4;
      out.set(nal, offset);
      offset += len;
    }

    return out;
  }

  /**
   * Build AVCDecoderConfigurationRecord from SPS/PPS.
   * Required by WebCodecs when AVCC-formatted chunks are fed.
   */
  protected buildConfigRecord(sps: NalUnit, pps: NalUnit): Uint8Array {
    const size = 7 + 2 + sps.length + 1 + 2 + pps.length;
    const out = new Uint8Array(size);
    let o = 0;

    out[o++] = 0x01;
    out[o++] = sps[1];
    out[o++] = sps[2];
    out[o++] = sps[3];
    out[o++] = 0xff;
    out[o++] = 0xe1;

    out[o++] = (sps.length >>> 8) & 0xff;
    out[o++] = sps.length & 0xff;
    out.set(sps, o);
    o += sps.length;

    out[o++] = 0x01;
    out[o++] = (pps.length >>> 8) & 0xff;
    out[o++] = pps.length & 0xff;
    out.set(pps, o);

    return out;
  }

  /**
   * Derive avc1 codec identifier from SPS profile/constraint/level bytes.
   */
  protected codecFromSPS(sps: NalUnit): string {
    return `avc1.${sps[1].toString(16).padStart(2, "0")}${sps[2]
      .toString(16)
      .padStart(2, "0")}${sps[3].toString(16).padStart(2, "0")}`;
  }
}

/**
 * Primary backend: WebCodecs + Canvas 2D drawImage().
 *
 * This backend matches the semantics of the original implementation closely:
 * - Wait for SPS/PPS before configure()
 * - Wait for keyframe/IDR before decoding inter frames
 * - Convert Annex-B NALs into AVCC
 * - Render VideoFrame directly to the provided canvas
 */
class WebCodecsH264DecoderBackend extends AbstractH264DecoderBackend {
  private decoder: VideoDecoder | null = null;
  private configured = false;
  public type: "webcodecs" | "mse" = "webcodecs";

  protected handleAccessUnit(accessUnit: H264AccessUnit): void {
    this.configureIfNeeded();
    if (!this.configured) {
      return;
    }

    if (this.waitingForKey) {
      if (!accessUnit.hasIDR && !accessUnit.isKey) {
        return;
      }
      this.waitingForKey = false;
    }

    const avcc = this.annexBToAvcc(accessUnit.nals);

    const chunk = new EncodedVideoChunk({
      type: accessUnit.hasIDR || accessUnit.isKey ? "key" : "delta",
      timestamp: accessUnit.pts,
      data: avcc,
    });

    try {
      this.decoder!.decode(chunk);
    } catch (error) {
      console.error("WebCodecs decode failed:", error);
      this.resetDecoder();
    }
  }

  public override close(): void {
    super.close();

    if (this.decoder) {
      try {
        this.decoder.close();
      } catch {
        // Ignore close errors during teardown.
      }
    }

    this.decoder = null;
    this.configured = false;
  }

  /**
   * Ensure a VideoDecoder instance exists.
   */
  private ensureDecoder(): void {
    if (this.decoder) {
      return;
    }

    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.resizeCanvas(frame.displayWidth, frame.displayHeight);
        this.ctx.drawImage(frame, 0, 0);
        frame.close();
      },
      error: (error) => {
        console.error("WebCodecs decoder error:", error);
        this.resetDecoder();
      },
    });
  }

  /**
   * Configure decoder once both SPS and PPS are available.
   */
  private configureIfNeeded(): void {
    if (this.configured || !this.latestSPS || !this.latestPPS) {
      return;
    }

    this.ensureDecoder();

    const codec = this.codecFromSPS(this.latestSPS);
    const description = this.buildConfigRecord(this.latestSPS, this.latestPPS);
    console.log(
      {
        codec,
        description,
        optimizeForLatency: true,
        hardwareAcceleration: "prefer-hardware",
      }
    )
    this.decoder!.configure({
      codec,
      description,
      optimizeForLatency: true,
      hardwareAcceleration: "prefer-hardware",
    });

    this.configured = true;
  }

  /**
   * Reset backend state after decoder failure.
   * The stream must wait for a new keyframe afterwards.
   */
  private resetDecoder(): void {
    if (this.decoder) {
      try {
        this.decoder.close();
      } catch {
        // Ignore close errors during recovery.
      }
    }

    this.decoder = null;
    this.configured = false;
    this.waitingForKey = true;
  }
}

/**
 * MSE backend for fMP4-over-WebSocket streaming.
 *
 * Expected input packet layout:
 *   [is_key: 1 byte][pts_us: 8 bytes, big-endian][fMP4 segment bytes]
 *
 * This backend intentionally preserves the caller-facing API:
 * - constructor(canvas, ...)
 * - decode(frameBytes, is_key, pts)
 * - close()
 *
 * In MSE mode, the backend primarily trusts the transport packet payload.
 * The extra decode() arguments are kept only for signature compatibility.
 */
class MSEH264DecoderBackend extends AbstractH264DecoderBackend {
  public type: "webcodecs" | "mse" = "mse";
  private readonly video: HTMLVideoElement;
  private mediaSource: MediaSource;
  private objectUrl: string | null = null;
  private sourceBuffer: SourceBuffer | null = null;

  private mediaSourceOpen = false;
  private appendQueue: Uint8Array[] = [];
  private renderLoopHandle: number | null = null;

  /**
   * Whether a valid init segment has already been received.
   * Media segments must not be appended before initialization completes.
   */
  private initReceived = false;

  /**
   * Current codec string derived from the init segment, e.g.:
   * video/mp4; codecs="avc1.64001f"
   */
  private mimeCodec: string | null = null;

  constructor(canvas: HTMLCanvasElement, muted = true) {
    super(canvas);

    this.video = document.createElement("video");
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = muted;
    this.video.preload = "auto";

    this.mediaSource = new MediaSource();
    this.objectUrl = URL.createObjectURL(this.mediaSource);
    this.video.src = this.objectUrl;

    this.mediaSource.addEventListener("sourceopen", this.handleSourceOpen);
    this.mediaSource.addEventListener("sourceended", this.handleSourceEnded);
    this.mediaSource.addEventListener("sourceclose", this.handleSourceClose);

    this.startRenderLoop();
  }

  /**
   * In MSE mode, the incoming payload is expected to be an fMP4 transport packet:
   *   [1B key][8B pts][segment]
   *
   * The inherited H.264 Annex-B parsing path is not used here.
   */
  protected handleAccessUnit(_accessUnit: H264AccessUnit): void {
    /**
     * This backend does not support the Annex-B access-unit path.
     * The public decode() method is overridden below and bypasses this method.
     */
    throw new Error("MSEH264DecoderBackend.handleAccessUnit() should not be called");
  }

  /**
   * Override the base decode() because MSE no longer consumes Annex-B access units.
   * It consumes transport packets that already carry fMP4 segments.
   */
  public override decode(frameBytes: Uint8Array, is_key: boolean, pts: number | Number): void {
    if (this.closed || frameBytes.byteLength === 0) {
      return;
    }

    const parsed = this.parseIncomingPacket(frameBytes, is_key, Number(pts));
    if (!parsed) {
      return;
    }

    const {segment} = parsed;
    const kind = this.detectSegmentKind(segment);

    if (kind === "unknown") {
      console.warn("Ignoring unknown MP4 segment in MSE backend");
      return;
    }

    if (kind === "init") {
      this.handleInitSegment(segment);
      return;
    }

    if (!this.initReceived) {
      /**
       * Drop media fragments until an init segment arrives.
       * This is mandatory for MSE correctness.
       */
      return;
    }

    this.enqueueSegment(segment);
    void this.flushAppendQueue();
  }

  public override close(): void {
    super.close();

    this.stopRenderLoop();

    this.mediaSource.removeEventListener("sourceopen", this.handleSourceOpen);
    this.mediaSource.removeEventListener("sourceended", this.handleSourceEnded);
    this.mediaSource.removeEventListener("sourceclose", this.handleSourceClose);

    if (this.sourceBuffer) {
      this.sourceBuffer.removeEventListener("updateend", this.handleUpdateEnd);
      this.sourceBuffer.removeEventListener("error", this.handleSourceBufferError);

      try {
        if (this.mediaSource.readyState === "open" && this.sourceBuffer.updating) {
          this.sourceBuffer.abort();
        }
      } catch {
        // Ignore teardown abort errors.
      }

      this.sourceBuffer = null;
    }

    try {
      this.video.pause();
    } catch {
      // Ignore pause errors during teardown.
    }

    this.video.removeAttribute("src");
    this.video.load();

    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }

    this.appendQueue = [];
    this.mediaSourceOpen = false;
    this.initReceived = false;
    this.mimeCodec = null;
  }

  /**
   * Parse one incoming packet.
   *
   * Preferred wire format:
   *   [is_key: 1 byte][pts_us: 8 bytes][fMP4 segment]
   *
   * For compatibility, if no transport header is detected, the whole buffer is
   * treated as a raw MP4 segment and the fallback arguments are used only to
   * preserve the method signature.
   */
  private parseIncomingPacket(
    data: Uint8Array,
    fallbackIsKey: boolean,
    fallbackPtsUs: number,
  ): { isKey: boolean; ptsUs: number; segment: Uint8Array } | null {
    if (data.byteLength >= 17) {
      const firstByte = data[0];

      if ((firstByte === 0 || firstByte === 1) && this.looksLikeMp4BoxAt(data, 9)) {
        return {
          isKey: firstByte === 1,
          ptsUs: this.readUint64BE(data, 1),
          segment: data.subarray(9),
        };
      }
    }

    return {
      isKey: fallbackIsKey,
      ptsUs: fallbackPtsUs,
      segment: data,
    };
  }

  /**
   * Detect whether the payload is an init segment or a media segment.
   */
  private detectSegmentKind(segment: Uint8Array): "init" | "media" | "unknown" {
    let offset = 0;
    let hasMoov = false;
    let hasMoof = false;
    let hasMdat = false;

    while (offset + 8 <= segment.byteLength) {
      const size = this.readUint32BE(segment, offset);
      if (size < 8 || offset + size > segment.byteLength) {
        break;
      }

      const type = this.readFourCC(segment, offset + 4);
      if (type === "moov") hasMoov = true;
      if (type === "moof") hasMoof = true;
      if (type === "mdat") hasMdat = true;

      offset += size;
    }

    if (hasMoov) return "init";
    if (hasMoof || hasMdat) return "media";
    return "unknown";
  }

  /**
   * Process an initialization segment.
   * If codec changes mid-stream, rebuild the whole MSE pipeline.
   */
  private handleInitSegment(initSegment: Uint8Array): void {
    const codec = this.extractAvc1CodecFromInitSegment(initSegment);
    if (!codec) {
      console.error("Failed to extract avc1 codec from init segment");
      return;
    }

    const mimeCodec = `video/mp4; codecs="${codec}"`;
    if (!MediaSource.isTypeSupported(mimeCodec)) {
      console.error("Unsupported MSE codec:", mimeCodec);
      return;
    }

    if (this.initReceived && this.mimeCodec && this.mimeCodec !== mimeCodec) {
      this.resetPipeline();
    }

    this.mimeCodec = mimeCodec;
    this.initReceived = true;

    this.enqueueSegment(initSegment);
    void this.flushAppendQueue();
  }

  private enqueueSegment(segment: Uint8Array): void {
    this.appendQueue.push(new Uint8Array(segment));
  }

  /**
   * Serialize all appendBuffer() operations.
   */
  private async flushAppendQueue(): Promise<void> {
    if (this.closed || !this.mediaSourceOpen) {
      return;
    }

    if (!this.sourceBuffer) {
      if (!this.mimeCodec) {
        return;
      }
      this.createSourceBuffer(this.mimeCodec);
    }

    if (!this.sourceBuffer || this.sourceBuffer.updating) {
      return;
    }

    const next = this.appendQueue.shift();
    if (!next) {
      return;
    }

    try {
      this.sourceBuffer.appendBuffer(next);
    } catch (error) {
      console.error("appendBuffer failed:", error);
      this.resetPipeline();
      return;
    }

    try {
      await this.video.play();
    } catch {
      // Muted autoplay may still be delayed by browser policy.
    }
  }

  private createSourceBuffer(mimeCodec: string): void {
    if (this.sourceBuffer || !this.mediaSourceOpen) {
      return;
    }

    this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeCodec);
    this.sourceBuffer.mode = "segments";
    this.sourceBuffer.addEventListener("updateend", this.handleUpdateEnd);
    this.sourceBuffer.addEventListener("error", this.handleSourceBufferError);
  }

  /**
   * Copy decoded frames from the hidden video element into the public canvas.
   */
  private startRenderLoop(): void {
    const draw = (): void => {
      if (this.closed) {
        return;
      }

      if (
        this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        this.video.videoWidth > 0 &&
        this.video.videoHeight > 0
      ) {
        this.resizeCanvas(this.video.videoWidth, this.video.videoHeight);
        this.ctx.drawImage(this.video, 0, 0);
      }

      this.renderLoopHandle = requestAnimationFrame(draw);
    };

    this.renderLoopHandle = requestAnimationFrame(draw);
  }

  private stopRenderLoop(): void {
    if (this.renderLoopHandle !== null) {
      cancelAnimationFrame(this.renderLoopHandle);
      this.renderLoopHandle = null;
    }
  }

  /**
   * Reset MSE pipeline state after a fatal append error or codec switch.
   *
   * Recovery policy:
   * - Tear down current SourceBuffer state
   * - Recreate MediaSource binding
   * - Wait for a fresh init segment from upstream
   *
   * This is more correct than only aborting SourceBuffer, because MSE state is
   * often unrecoverable once the append timeline becomes inconsistent.
   */
  private resetPipeline(): void {
    if (this.sourceBuffer) {
      this.sourceBuffer.removeEventListener("updateend", this.handleUpdateEnd);
      this.sourceBuffer.removeEventListener("error", this.handleSourceBufferError);

      try {
        if (this.mediaSource.readyState === "open" && this.sourceBuffer.updating) {
          this.sourceBuffer.abort();
        }
      } catch {
        // Ignore abort errors during reset.
      }

      this.sourceBuffer = null;
    }

    try {
      this.video.pause();
    } catch {
      // Ignore pause errors during reset.
    }

    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }

    this.mediaSource.removeEventListener("sourceopen", this.handleSourceOpen);
    this.mediaSource.removeEventListener("sourceended", this.handleSourceEnded);
    this.mediaSource.removeEventListener("sourceclose", this.handleSourceClose);

    this.mediaSource = new MediaSource();
    this.mediaSource.addEventListener("sourceopen", this.handleSourceOpen);
    this.mediaSource.addEventListener("sourceended", this.handleSourceEnded);
    this.mediaSource.addEventListener("sourceclose", this.handleSourceClose);

    this.objectUrl = URL.createObjectURL(this.mediaSource);
    this.video.src = this.objectUrl;

    this.appendQueue = [];
    this.mediaSourceOpen = false;
    this.initReceived = false;
    this.mimeCodec = null;
  }

  /**
   * Extract avc1.<profile><compat><level> from the avcC box in the init segment.
   */
  private extractAvc1CodecFromInitSegment(initSegment: Uint8Array): string | null {
    const avcCOffset = this.findBoxOffset(initSegment, "avcC");
    if (avcCOffset < 0) {
      return null;
    }

    const boxSize = this.readUint32BE(initSegment, avcCOffset);
    if (boxSize < 12 || avcCOffset + boxSize > initSegment.byteLength) {
      return null;
    }

    const payloadOffset = avcCOffset + 8;
    if (payloadOffset + 4 > initSegment.byteLength) {
      return null;
    }

    const profile = initSegment[payloadOffset + 1];
    const compat = initSegment[payloadOffset + 2];
    const level = initSegment[payloadOffset + 3];

    return `avc1.${profile.toString(16).padStart(2, "0")}${compat
      .toString(16)
      .padStart(2, "0")}${level.toString(16).padStart(2, "0")}`;
  }

  private findBoxOffset(data: Uint8Array, type: string): number {
    for (let offset = 0; offset + 8 <= data.byteLength; offset++) {
      if (
        data[offset + 4] === type.charCodeAt(0) &&
        data[offset + 5] === type.charCodeAt(1) &&
        data[offset + 6] === type.charCodeAt(2) &&
        data[offset + 7] === type.charCodeAt(3)
      ) {
        const size = this.readUint32BE(data, offset);
        if (size >= 8 && offset + size <= data.byteLength) {
          return offset;
        }
      }
    }
    return -1;
  }

  private looksLikeMp4BoxAt(data: Uint8Array, offset: number): boolean {
    if (data.byteLength < offset + 8) {
      return false;
    }

    const size = this.readUint32BE(data, offset);
    if (size < 8 || offset + size > data.byteLength) {
      return false;
    }

    const type = this.readFourCC(data, offset + 4);
    return /^[A-Za-z0-9 ]{4}$/.test(type);
  }

  private readUint32BE(data: Uint8Array, offset: number): number {
    return (
      (data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]
    ) >>> 0;
  }

  private readUint64BE(data: Uint8Array, offset: number): number {
    const view = new DataView(data.buffer, data.byteOffset + offset, 8);
    return Number(view.getBigUint64(0, false));
  }

  private readFourCC(data: Uint8Array, offset: number): string {
    return String.fromCharCode(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      data[offset + 3],
    );
  }

  private handleSourceOpen = (): void => {
    this.mediaSourceOpen = true;
    void this.flushAppendQueue();
  };

  private handleSourceEnded = (): void => {
    this.mediaSourceOpen = false;
  };

  private handleSourceClose = (): void => {
    this.mediaSourceOpen = false;
  };

  private handleUpdateEnd = (): void => {
    /**
     * Pull playback toward the live edge to reduce buffer-induced latency.
     */
    try {
      if (this.video.buffered.length > 0) {
        const liveEdge = this.video.buffered.end(this.video.buffered.length - 1);
        const lag = liveEdge - this.video.currentTime;
        if (lag > 0.25) {
          this.video.currentTime = Math.max(0, liveEdge - 0.05);
        }
      }
    } catch {
      // Ignore transient buffered-range errors.
    }

    /**
     * Light buffer eviction to avoid unbounded memory growth.
     */
    try {
      if (
        this.sourceBuffer &&
        !this.sourceBuffer.updating &&
        this.video.buffered.length > 0 &&
        this.video.currentTime > 8
      ) {
        const removeEnd = this.video.currentTime - 4;
        if (removeEnd > 0) {
          this.sourceBuffer.remove(0, removeEnd);
          return;
        }
      }
    } catch {
      // Ignore removal errors; append flow continues.
    }

    void this.flushAppendQueue();
  };

  private handleSourceBufferError = (): void => {
    console.error("SourceBuffer error event received");
    this.resetPipeline();
  };
}

/**
 * Backend selection helper.
 */
class H264DecoderBackendFactory {
  public static create(
    canvas: HTMLCanvasElement,
    options: H264DecoderOptions = {},
  ): AbstractH264DecoderBackend {
    const preferred = options.backend ?? "auto";

    if (preferred === "webcodecs") {
      return this.createWebCodecsBackend(canvas);
    }

    if (preferred === "mse") {
      return this.createMSEBackend(canvas, options);
    }

    /**
     * Auto mode:
     * 1. Prefer WebCodecs in secure and capable environments
     * 2. Fall back to MSE if supported and a muxer is supplied
     */
    if (this.canUseWebCodecs()) {
      return this.createWebCodecsBackend(canvas);
    }

    if (this.canUseMSE()) {
      return this.createMSEBackend(canvas, options);
    }

    throw new Error("No supported H.264 browser backend is available");
  }

  private static createWebCodecsBackend(
    canvas: HTMLCanvasElement,
  ): AbstractH264DecoderBackend {
    if (!this.canUseWebCodecs()) {
      throw new Error("WebCodecs backend requested but VideoDecoder is unavailable");
    }
    return new WebCodecsH264DecoderBackend(canvas);
  }

  private static createMSEBackend(
    canvas: HTMLCanvasElement,
    options: H264DecoderOptions,
  ): AbstractH264DecoderBackend {
    if (!this.canUseMSE()) {
      throw new Error("MSE backend requested but MediaSource is unavailable");
    }

    return new MSEH264DecoderBackend(canvas, options.muted ?? true);
  }

  private static canUseWebCodecs(): boolean {
    return (typeof window !== "undefined" &&
      typeof VideoDecoder !== "undefined" && window.isSecureContext);
  }

  private static canUseMSE(): boolean {
    return typeof window !== "undefined" && typeof MediaSource !== "undefined";
  }
}

/**
 * Public facade class.
 *
 * This is the only class the rest of your application needs to know.
 * It preserves the original constructor / decode / close shape while hiding
 * backend differences completely.
 */
export class H264WebSocketDecoder {
  private readonly backend: AbstractH264DecoderBackend;

  constructor(canvas: HTMLCanvasElement, options: H264DecoderOptions = {}) {
    this.backend = H264DecoderBackendFactory.create(canvas, options);
  }

  /**
   * Preserve the original public method signature.
   */
  public decode(frameBytes: Uint8Array, is_key: boolean, pts: TimestampLike): void {
    // console.log(frameBytes);
    // console.log("==================================");
    this.backend.decode(frameBytes, is_key, pts);
  }

  public close(): void {
    console.trace()
    this.backend.close();
  }

  public getType(): "AnnexB" | "fMP4" {
    const type = this.backend.type!;
    return {
      "webcodecs": "AnnexB",
      "mse": "fMP4"
    }[type] as "AnnexB" | "fMP4";
  }
}