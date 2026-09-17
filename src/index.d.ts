export interface Dimensions {
  width: number;
  height: number;
}

export interface Options {
  /** Directory that maps to `/` on the site. Default `'public'`. */
  publicDir?: string;
  /** How many leading images get `loading="eager"`. Default `1`. */
  eagerCount?: number;
  /** Replace existing width/height attributes instead of only filling gaps. Default `false`. */
  overwrite?: boolean;
  /** Called when a local image cannot be measured. */
  onWarn?: (message: string) => void;
}

/** Sniff image dimensions out of the first bytes of a buffer. No decoder involved. */
export declare function readSize(buffer: Buffer | Uint8Array): Dimensions | null;

export default function rehypeImageDimensions(options?: Options): (tree: any) => void;
