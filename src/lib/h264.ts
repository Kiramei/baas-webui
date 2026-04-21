/**
 * H264 WebSocket Decoder (Annex-B → AVCC → WebCodecs)
 *
 * This implementation is designed for:
 * - Low-latency streaming (compatible with Scrcpy)
 * - Robust decoder lifecycle handling
 * - Strict compliance with WebCodecs expectations
 *
 * Key guarantees:
 * - No empty/invalid NAL units are passed to decoder
 * - Decoder is only fed after SPS/PPS + IDR are available
 * - Decoder is reset safely on failure
 */

type NalUnit = Uint8Array;

export class H264WebSocketDecoder {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private decoder: VideoDecoder | null = null;
  private configured = false;

  private latestSPS: NalUnit | null = null;
  private latestPPS: NalUnit | null = null;

  private waitingForKey = true;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", {alpha: false});
    if (!ctx) {
      throw new Error("Failed to acquire 2D context");
    }

    this.canvas = canvas;
    this.ctx = ctx;
  }

  /**
   * Resize canvas only when necessary to avoid redundant layout work
   */
  private resizeCanvas(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /**
   * Split Annex-B byte stream into NAL units
   *
   * IMPORTANT:
   * - Filters out empty NALs caused by consecutive start codes
   * - Returns raw NAL payload (without start code)
   */
  private splitAnnexBNals(buffer: ArrayBuffer): NalUnit[] {
    const bytes = new Uint8Array(buffer);
    const starts: number[] = [];

    for (let i = 0; i < bytes.length - 3; i++) {
      if (
        bytes[i] === 0 &&
        bytes[i + 1] === 0 &&
        (
          bytes[i + 2] === 1 ||
          (bytes[i + 2] === 0 && bytes[i + 3] === 1)
        )
      ) {
        starts.push(i);
      }
    }

    if (starts.length === 0) return [];

    const nals: NalUnit[] = [];

    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];
      const end = i + 1 < starts.length ? starts[i + 1] : bytes.length;

      let startCodeLength = 3;
      if (bytes[start + 2] === 0 && bytes[start + 3] === 1) {
        startCodeLength = 4;
      }

      const nal = bytes.slice(start + startCodeLength, end);

      // Filter invalid / empty NALs
      if (nal.length === 0) continue;

      const type = nal[0] & 0x1f;
      if (type <= 0 || type > 12) continue;

      nals.push(nal);
    }

    return nals;
  }

  /**
   * Extract NAL unit type
   */
  private getNalType(nal: NalUnit): number {
    return nal.length > 0 ? (nal[0] & 0x1f) : -1;
  }

  /**
   * Convert Annex-B NAL units into AVCC format
   *
   * AVCC = [length][NAL][length][NAL]...
   */
  private annexBToAvcc(nals: NalUnit[]): Uint8Array {
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
   * Build AVCDecoderConfigurationRecord from SPS/PPS
   *
   * Required by WebCodecs when feeding AVCC stream
   */
  private buildConfigRecord(sps: NalUnit, pps: NalUnit): Uint8Array {
    const size =
      7 +
      2 + sps.length +
      1 +
      2 + pps.length;

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
   * Build codec string from SPS
   */
  private codecFromSPS(sps: NalUnit): string {
    return `avc1.${sps[1].toString(16).padStart(2, "0")}${
      sps[2].toString(16).padStart(2, "0")
    }${sps[3].toString(16).padStart(2, "0")}`;
  }

  /**
   * Ensure decoder instance exists
   */
  private ensureDecoder(): void {
    if (this.decoder) return;

    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.resizeCanvas(frame.displayWidth, frame.displayHeight);
        this.ctx.drawImage(frame, 0, 0);
        frame.close();
      },
      error: (e) => {
        console.error("Decoder error:", e);
        this.resetDecoder();
      },
    });
  }

  /**
   * Reset decoder safely
   */
  private resetDecoder(): void {
    if (this.decoder) {
      try {
        this.decoder.close();
      } catch {
      }
    }

    this.decoder = null;
    this.configured = false;
    this.waitingForKey = true;
  }

  /**
   * Configure decoder if SPS/PPS are available
   */
  private configureIfNeeded(): void {
    if (this.configured || !this.latestSPS || !this.latestPPS) return;

    this.ensureDecoder();

    const codec = this.codecFromSPS(this.latestSPS);
    const description = this.buildConfigRecord(this.latestSPS, this.latestPPS);

    this.decoder!.configure({
      codec,
      description,
      optimizeForLatency: true,
      hardwareAcceleration: "prefer-hardware",
    });

    this.configured = true;
    console.log("Decoder configured:", codec);
  }

  /**
   * Decode incoming H264 Frame
   *
   * Frame format:
   * [raw Annex-B H264 bytes]
   */
  public decode(frameBytes: Uint8Array, is_key: boolean, pts: Number): void {

    const nals = this.splitAnnexBNals(
      frameBytes.buffer.slice(
        frameBytes.byteOffset,
        frameBytes.byteOffset + frameBytes.byteLength
      )
    );

    let hasIDR = false;

    for (const nal of nals) {
      const t = this.getNalType(nal);

      if (t === 7) this.latestSPS = nal;
      else if (t === 8) this.latestPPS = nal;
      else if (t === 5) {
        hasIDR = true;
      }
    }

    this.configureIfNeeded();
    if (!this.configured) return;

    if (this.waitingForKey) {
      if (!hasIDR && !is_key) {
        return;
      }
      this.waitingForKey = false;
    }

    const avcc = this.annexBToAvcc(nals);

    const chunk = new EncodedVideoChunk({
      type: hasIDR || is_key ? "key" : "delta",
      timestamp: Number(pts),
      data: avcc,
    });

    try {
      this.decoder!.decode(chunk);
    } catch (e) {
      console.error("decode failed:", e);
      this.resetDecoder();
    }
  }

  public close(): void {
    this.decoder?.close();
  }
}
