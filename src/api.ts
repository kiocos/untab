import { invoke } from "@tauri-apps/api/core";
import type { Library, CaptureResult } from "./types";

export const api = {
  library: () => invoke<Library>("get_library"),
  clipboard: () => invoke<string>("read_clipboard"),
  capture: (collectionId: string | null, text?: string) =>
    invoke<CaptureResult>("capture_clipboard", {
      collectionId,
      text: text ?? null,
    }),
  files: (paths: string[], collectionId: string | null) =>
    invoke<CaptureResult>("import_files", { paths, collectionId }),
  pickFiles: (collectionId: string | null) =>
    invoke<CaptureResult>("pick_files", { collectionId }),
  saveFile: (id: string) => invoke<boolean>("save_file", { id }),
  revealFile: (id: string) => invoke("reveal_file", { id }),
  add: (url: string, collectionId: string | null) =>
    invoke<{ id: string; duplicate: boolean }>("add_bookmark", {
      url,
      collectionId,
    }),
  favorite: (id: string, favorite: boolean) =>
    invoke("set_favorite", { id, favorite }),
  createNote: (title: string, content: string, collectionId: string | null) =>
    invoke<{ id: string; duplicate: boolean }>("create_note", {
      title,
      content,
      collectionId,
    }),
  editNote: (
    id: string,
    title: string,
    content: string,
    collectionId: string | null,
  ) => invoke("edit_note", { id, title, content, collectionId }),
  edit: (id: string, title: string, collectionId: string | null) =>
    invoke("edit_bookmark", { id, title, collectionId }),
  remove: (id: string) => invoke("delete_bookmark", { id }),
  restore: (id: string) => invoke("restore_bookmark", { id }),
  open: (id: string) => invoke("open_bookmark", { id }),
  copy: (id: string) => invoke("copy_bookmark", { id }),
  refresh: (id: string) => invoke("refresh_preview", { id }),
  createCollection: (name: string, color: string) =>
    invoke<string>("create_collection", { name, color }),
  editCollection: (id: string, name: string, color: string) =>
    invoke("edit_collection", { id, name, color }),
  deleteCollection: (id: string) => invoke("delete_collection", { id }),
  export: () => invoke<boolean>("export_library"),
  import: () => invoke<number | null>("import_library"),
};
