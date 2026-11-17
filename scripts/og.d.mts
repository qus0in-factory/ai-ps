export function ogBlock(config: OgConfig): string;
export function replaceOgBlock(html: string, block: string): string;
export function loadConfig(): Promise<OgConfig>;
export function generateImage(output: string): Promise<void>;

export interface OgSite {
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
  imageAlt: string;
}

export interface OgImage {
  width: number;
  height: number;
}

export interface OgFeature {
  route: string;
  image: string | null;
  weight: number;
}

export interface OgConfig {
  site: OgSite;
  background: string;
  image: OgImage;
  features: OgFeature[];
}
