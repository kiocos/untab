export type Kind =
  | "site"
  | "article"
  | "video"
  | "image"
  | "document"
  | "note"
  | "audio"
  | "file";

export interface Attachment {
  path: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
}

export interface CaptureResult {
  items: { id: string; duplicate: boolean }[];
  errors: string[];
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  description: string;
  content: string;
  attachment: Attachment | null;
  domain: string;
  kind: Kind;
  collectionId: string | null;
  favorite: boolean;
  imagePath: string | null;
  createdAt: number;
  previewStatus: "pending" | "ready" | "unavailable";
}

export interface Collection {
  id: string;
  name: string;
  color: string;
}

export interface Library {
  bookmarks: Bookmark[];
  collections: Collection[];
}

export const kindLabels: Record<Kind, string> = {
  site: "Site",
  article: "Artigo",
  video: "Vídeo",
  image: "Imagem",
  document: "Documento",
  note: "Nota",
  audio: "Áudio",
  file: "Arquivo",
};

export const collectionColors = [
  "#a999cd",
  "#8fa7a5",
  "#c4a788",
  "#c58e9a",
  "#91a4cf",
  "#a3b78c",
];
