declare class Avc {
  constructor(options?: { locateFile?: (path: string) => string });

  public onPictureDecoded: (buffer: Uint8Array, width: number, height: number) => void;
  public decode(data: Uint8Array): void;
}

export = Avc;
