import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Bookmark as BookmarkIcon,
  LayoutGrid,
  Star,
  Search,
  Plus,
  ArrowDownUp,
  Clipboard,
  X,
  ExternalLink,
  Copy,
  Trash2,
  RefreshCw,
  LoaderCircle,
  MoreHorizontal,
  Download,
  Upload,
  FolderPlus,
  Pencil,
  Check,
  Link2,
  FileText,
  Play,
  Image as ImageIcon,
  Globe,
  ChevronDown,
  StickyNote,
  File,
  Music2,
  FolderOpen,
  Paperclip,
} from "lucide-react";
import { api } from "./api";
import { Updates } from "./Updates";
import { isMac, shortcut } from "./platform";
import {
  collectionColors,
  kindLabels,
  type Bookmark,
  type Collection,
  type Kind,
  type Library,
  type CaptureResult,
} from "./types";

type View = "all" | "favorites" | string;
type Dialog =
  | { type: "bookmark"; id: string }
  | { type: "collection"; collection?: Collection }
  | { type: "add" }
  | { type: "note" }
  | null;
type Toast = {
  id: number;
  text: string;
  error?: boolean;
  action?: { label: string; run: () => void };
};
const NoticeContext = createContext<{
  toast: Toast | null;
  dismiss: () => void;
}>({ toast: null, dismiss: () => {} });
const blank: Library = { bookmarks: [], collections: [] };
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeStyle: "short",
});
const relativeFormatter = new Intl.RelativeTimeFormat("pt-BR", {
  numeric: "auto",
  style: "short",
});

function fileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Agora";
  if (minutes < 60) return relativeFormatter.format(-minutes, "minute");
  if (minutes < 1440)
    return relativeFormatter.format(-Math.floor(minutes / 60), "hour");
  return relativeFormatter.format(-Math.floor(minutes / 1440), "day");
}

function normalizeSearch(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function errorText(error: unknown) {
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "Não foi possível concluir a ação";
}

function Notice() {
  const { toast, dismiss } = useContext(NoticeContext);
  return (
    toast && (
      <div
        className={`toast ${toast.error ? "error" : ""}`}
        role={toast.error ? "alert" : "status"}
      >
        <span>{toast.text}</span>
        {toast.action && (
          <button
            onClick={() => {
              toast.action?.run();
              dismiss();
            }}
          >
            {toast.action.label}
          </button>
        )}
        <button
          className="toast-close"
          aria-label="Fechar aviso"
          onClick={dismiss}
        >
          <X size={14} />
        </button>
      </div>
    )
  );
}

function Cover({ bookmark }: { bookmark: Bookmark }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [bookmark.imagePath]);
  const tone =
    [...bookmark.domain].reduce(
      (sum, character) => sum + character.charCodeAt(0),
      0,
    ) % 6;
  const KindIcon = {
    site: Globe,
    article: FileText,
    video: Play,
    image: ImageIcon,
    document: FileText,
    note: StickyNote,
    audio: Music2,
    file: File,
  }[bookmark.kind];
  if (bookmark.kind === "note") {
    return (
      <div className="cover note-cover">
        <StickyNote aria-hidden="true" />
        <p>{bookmark.content}</p>
      </div>
    );
  }
  return (
    <div className={`cover tone-${tone}`}>
      {bookmark.imagePath && !failed ? (
        <img
          src={convertFileSrc(bookmark.imagePath)}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="fallback-cover" aria-hidden="true">
          <span className="fallback-letter">
            {bookmark.attachment ? (
              <KindIcon />
            ) : (
              bookmark.domain.replace(/^www\./, "")[0]?.toUpperCase() || "↗"
            )}
          </span>
          <span className="fallback-domain">
            {bookmark.attachment
              ? bookmark.attachment.name.split(".").pop()?.toUpperCase()
              : bookmark.domain}
          </span>
          <KindIcon className="fallback-kind" />
        </div>
      )}
      {bookmark.previewStatus === "pending" && (
        <span className="preview-loading" title="Carregando prévia">
          <LoaderCircle className="spin" aria-label="Carregando prévia" />
        </span>
      )}
      {bookmark.kind === "video" && bookmark.previewStatus !== "pending" && (
        <span className="video-badge">
          <Play size={12} />
        </span>
      )}
    </div>
  );
}

function FilePreview({ bookmark }: { bookmark: Bookmark }) {
  const file = bookmark.attachment!;
  const source = convertFileSrc(file.path);
  const [failed, setFailed] = useState(false);
  if (
    !failed &&
    bookmark.kind === "image" &&
    ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.mime)
  ) {
    return (
      <img
        className="file-image"
        src={source}
        alt={file.name}
        onError={() => setFailed(true)}
      />
    );
  }
  if (!failed && (bookmark.kind === "video" || bookmark.kind === "audio")) {
    return (
      <div className="file-player">
        {bookmark.kind === "video" ? (
          <video
            controls
            preload="metadata"
            src={source}
            onError={() => setFailed(true)}
          />
        ) : (
          <>
            <Music2 />
            <audio
              controls
              preload="metadata"
              src={source}
              onError={() => setFailed(true)}
            />
          </>
        )}
      </div>
    );
  }
  return (
    <>
      <Cover bookmark={bookmark} />
      {failed && (
        <p className="media-fallback">
          Use “Abrir arquivo” para visualizar no seu computador
        </p>
      )}
    </>
  );
}

function Modal({
  children,
  close,
  drawer = false,
  label,
  role = "dialog",
  describedBy,
}: {
  children: ReactNode;
  close: () => void;
  drawer?: boolean;
  label: string;
  role?: "dialog" | "alertdialog";
  describedBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={drawer ? "modal drawer" : "modal"}
      aria-label={label}
      role={role}
      aria-describedby={describedBy}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            close();
        }
      }}
    >
      {children}
      <Notice />
    </dialog>
  );
}

function DeleteDialog({
  bookmark,
  close,
  confirm,
}: {
  bookmark: Bookmark;
  close: () => void;
  confirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      label="Confirmar exclusão"
      role="alertdialog"
      describedBy="delete-message"
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="modal-header">
        <h2>Excluir item?</h2>
      </div>
      <p id="delete-message" className="delete-message">
        “{bookmark.title}” será removido da biblioteca.
      </p>
      <div className="modal-actions">
        <button autoFocus className="secondary" disabled={busy} onClick={close}>
          Cancelar
        </button>
        <button
          className="primary danger-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await confirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <LoaderCircle className="spin" /> : <Trash2 />}
          {busy ? "Excluindo…" : "Excluir"}
        </button>
      </div>
    </Modal>
  );
}

function BookmarkDetails({
  bookmark,
  collections,
  close,
  saved,
  remove,
  notify,
}: {
  bookmark: Bookmark;
  collections: Collection[];
  close: () => void;
  saved: () => Promise<void>;
  remove: (bookmark: Bookmark) => void;
  notify: (text: string, error?: boolean) => void;
}) {
  const [title, setTitle] = useState(bookmark.title);
  const [content, setContent] = useState(bookmark.content);
  const isNote = bookmark.kind === "note";
  const file = bookmark.attachment;
  const [collectionId, setCollectionId] = useState(bookmark.collectionId ?? "");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setTitle(bookmark.title);
      setContent(bookmark.content);
      setCollectionId(bookmark.collectionId ?? "");
    }
  }, [bookmark.title, bookmark.content, bookmark.collectionId, dirty]);
  const action = async (
    operation: () => Promise<unknown>,
    success?: string,
  ) => {
    try {
      await operation();
      await saved();
      if (success) notify(success);
    } catch (error) {
      notify(errorText(error), true);
    }
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (isNote)
        await api.editNote(bookmark.id, title, content, collectionId || null);
      else await api.edit(bookmark.id, title, collectionId || null);
      setDirty(false);
      await saved();
      notify("Alterações salvas");
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      drawer
      label={isNote ? "Editar nota" : "Detalhes do bookmark"}
      close={close}
    >
      <div className="modal-header">
        <span>{isNote ? "Nota" : "Detalhes"}</span>
        <button
          className="icon-button"
          aria-label="Fechar detalhes"
          onClick={close}
        >
          <X />
        </button>
      </div>
      {!isNote &&
        (file ? (
          <FilePreview bookmark={bookmark} />
        ) : (
          <Cover bookmark={bookmark} />
        ))}
      <form onSubmit={save} className="details-form">
        <label className="field-label" htmlFor="bookmark-title">
          Título
        </label>
        <textarea
          id="bookmark-title"
          className="title-input"
          value={title}
          maxLength={500}
          rows={2}
          required
          onChange={(event) => {
            setTitle(event.target.value);
            setDirty(true);
          }}
        />
        {isNote ? (
          <>
            <label className="field-label" htmlFor="note-content">
              Texto
            </label>
            <textarea
              id="note-content"
              className="note-editor"
              value={content}
              maxLength={100000}
              rows={12}
              required
              onChange={(event) => {
                setContent(event.target.value);
                setDirty(true);
              }}
            />
          </>
        ) : file ? (
          <p className="file-name">
            {file.name} · {fileSize(file.size)}
          </p>
        ) : (
          <>
            <button
              type="button"
              className="url-button"
              title={bookmark.url}
              onClick={() => void action(() => api.open(bookmark.id))}
            >
              {bookmark.url}
              <ExternalLink size={13} />
            </button>
            {bookmark.description && (
              <p className="description">{bookmark.description}</p>
            )}
          </>
        )}
        <label className="field-label" htmlFor="bookmark-collection">
          Coleção
        </label>
        <div className="select-wrap">
          <select
            id="bookmark-collection"
            value={collectionId}
            onChange={(event) => {
              setCollectionId(event.target.value);
              setDirty(true);
            }}
          >
            <option value="">Sem coleção</option>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
        <dl className="details-meta">
          <dt>Tipo</dt>
          <dd>{kindLabels[bookmark.kind]}</dd>
          <dt>Salvo</dt>
          <dd>{dateFormatter.format(bookmark.createdAt)}</dd>
        </dl>
        {!isNote && !file && (
          <div className="preview-status">
            <span>
              {bookmark.previewStatus === "pending"
                ? "Carregando prévia…"
                : bookmark.previewStatus === "unavailable"
                  ? "Prévia indisponível"
                  : "Prévia atualizada"}
            </span>
            <button
              type="button"
              className="icon-button"
              title="Atualizar prévia"
              aria-label="Atualizar prévia"
              disabled={bookmark.previewStatus === "pending"}
              onClick={() => void action(() => api.refresh(bookmark.id))}
            >
              <RefreshCw
                size={14}
                className={bookmark.previewStatus === "pending" ? "spin" : ""}
              />
            </button>
          </div>
        )}
        {dirty && (
          <button
            className="primary save-button"
            disabled={busy || !title.trim() || (isNote && !content.trim())}
          >
            {busy ? <LoaderCircle className="spin" /> : <Check />}Salvar
            alterações
          </button>
        )}
      </form>
      <div className="details-actions">
        {file && (
          <>
            <button
              className="secondary"
              onClick={() =>
                void action(async () => {
                  if (await api.saveFile(bookmark.id)) notify("Arquivo salvo");
                })
              }
            >
              <Download />
              Salvar como…
            </button>
            <button
              className="secondary"
              onClick={() => void action(() => api.revealFile(bookmark.id))}
            >
              <FolderOpen />
              {isMac ? "Mostrar no Finder" : "Mostrar na pasta"}
            </button>
          </>
        )}
        {!isNote && (
          <button
            className="primary"
            onClick={() => void action(() => api.open(bookmark.id))}
          >
            <ExternalLink />
            {file ? "Abrir arquivo" : "Abrir no navegador"}
          </button>
        )}
        <button
          className="secondary"
          onClick={() =>
            void action(
              () => api.copy(bookmark.id),
              isNote
                ? "Texto copiado"
                : file
                  ? "Arquivo copiado"
                  : "Link copiado",
            )
          }
        >
          <Copy />
          {isNote ? "Copiar texto" : file ? "Copiar arquivo" : "Copiar link"}
        </button>
        <button
          className="secondary"
          onClick={() =>
            void action(() => api.favorite(bookmark.id, !bookmark.favorite))
          }
        >
          <Star className={bookmark.favorite ? "filled-star" : ""} />
          {bookmark.favorite ? "Remover dos favoritos" : "Favoritar"}
        </button>
        <button className="danger subtle" onClick={() => void remove(bookmark)}>
          <Trash2 />
          Excluir
        </button>
      </div>
    </Modal>
  );
}

function CollectionDialog({
  collection,
  close,
  save,
  remove,
}: {
  collection?: Collection;
  close: () => void;
  save: (name: string, color: string) => Promise<void>;
  remove: () => Promise<void>;
}) {
  const [name, setName] = useState(collection?.name ?? "");
  const [color, setColor] = useState(collection?.color ?? collectionColors[0]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await save(name, color);
      close();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal label={collection ? "Editar coleção" : "Nova coleção"} close={close}>
      <div className="modal-header">
        <h2>{collection ? "Editar coleção" : "Nova coleção"}</h2>
        <button className="icon-button" aria-label="Fechar" onClick={close}>
          <X />
        </button>
      </div>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="collection-name">
          Nome
        </label>
        <input
          autoFocus
          id="collection-name"
          maxLength={80}
          required
          placeholder="Nome da coleção"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="color-picker" role="group" aria-label="Cor da coleção">
          {collectionColors.map((value) => (
            <button
              key={value}
              type="button"
              className={`color-option ${color === value ? "selected" : ""}`}
              style={{ background: value }}
              aria-label={`Cor ${value}`}
              aria-pressed={color === value}
              onClick={() => setColor(value)}
            >
              {color === value && <Check />}
            </button>
          ))}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={close}>
            Cancelar
          </button>
          <button className="primary" disabled={busy || !name.trim()}>
            {busy && <LoaderCircle className="spin" />}
            {collection ? "Salvar" : "Criar coleção"}
          </button>
        </div>
      </form>
      {collection && (
        <div className="collection-delete">
          {confirmDelete && <p>Os links serão mantidos sem coleção.</p>}
          <button
            className="danger subtle"
            disabled={busy}
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              setBusy(true);
              try {
                await remove();
                close();
              } catch (error) {
                setError(errorText(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Trash2 />
            {confirmDelete ? "Confirmar exclusão" : "Excluir coleção"}
          </button>
        </div>
      )}
    </Modal>
  );
}

function AddDialog({
  close,
  add,
}: {
  close: () => void;
  add: (url: string) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal label="Adicionar link" close={close}>
      <div className="modal-header">
        <h2>Adicionar link</h2>
        <button className="icon-button" aria-label="Fechar" onClick={close}>
          <X />
        </button>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await add(url);
            close();
          } catch (error) {
            setError(errorText(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field-label" htmlFor="link-url">
          Endereço
        </label>
        <input
          autoFocus
          id="link-url"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://…"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button className="secondary" type="button" onClick={close}>
            Cancelar
          </button>
          <button className="primary" disabled={busy || !url.trim()}>
            {busy ? <LoaderCircle className="spin" /> : <Plus />}Adicionar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NoteDialog({
  close,
  create,
}: {
  close: () => void;
  create: (title: string, content: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal label="Nova nota" close={close}>
      <div className="modal-header">
        <h2>Nova nota</h2>
        <button className="icon-button" aria-label="Fechar" onClick={close}>
          <X />
        </button>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await create(title, content);
            close();
          } catch (error) {
            setError(errorText(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field-label" htmlFor="new-note-title">
          Título
        </label>
        <input
          id="new-note-title"
          value={title}
          maxLength={500}
          placeholder="Opcional"
          onChange={(event) => setTitle(event.target.value)}
        />
        <label className="field-label note-label" htmlFor="new-note-content">
          Texto
        </label>
        <textarea
          autoFocus
          id="new-note-content"
          className="note-editor"
          value={content}
          maxLength={100000}
          rows={9}
          required
          placeholder="Escreva sua nota…"
          onChange={(event) => setContent(event.target.value)}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button className="secondary" type="button" onClick={close}>
            Cancelar
          </button>
          <button className="primary" disabled={busy || !content.trim()}>
            {busy ? <LoaderCircle className="spin" /> : <Check />}Salvar nota
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function App() {
  const [library, setLibrary] = useState<Library>(blank);
  const [view, setView] = useState<View>("all");
  const [kind, setKind] = useState<Kind | "all">("all");
  const [query, setQuery] = useState("");
  const [newest, setNewest] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pendingDelete, setPendingDelete] = useState<Bookmark | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [menu, setMenu] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const busyPaste = useRef(false);
  const toastId = useRef(0);

  const notify = useCallback(
    (text: string, error = false, action?: Toast["action"]) => {
      setToast({ id: ++toastId.current, text, error, action });
    },
    [],
  );

  const reload = useCallback(async () => {
    const revision = ++request.current;
    const data = await api.library();
    if (revision === request.current) {
      setLibrary(data);
      setLoadError("");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let stopped = false;
    let refreshTimer: ReturnType<typeof setTimeout>;
    void listen("library-changed", () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(
        () => void reload().catch((error) => notify(errorText(error), true)),
        50,
      );
    })
      .then((unlisten) => {
        if (stopped) unlisten();
        else dispose = unlisten;
      })
      .catch(() => {});
    void reload().catch((error) => {
      setLoadError(errorText(error));
      setLoading(false);
    });
    const refreshOnFocus = () =>
      void reload().catch((error) => notify(errorText(error), true));
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      stopped = true;
      dispose?.();
      clearTimeout(refreshTimer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [reload, notify]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.action ? 10000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(null), 2400);
    return () => clearTimeout(timer);
  }, [highlight]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menu]);

  const activeCollection = library.collections.find(
    (collection) => collection.id === view,
  );
  const title =
    view === "favorites"
      ? "Favoritos"
      : (activeCollection?.name ?? "Biblioteca");
  const collectionsById = useMemo(
    () =>
      new Map(
        library.collections.map((collection) => [collection.id, collection]),
      ),
    [library.collections],
  );
  const filtered = useMemo(() => {
    const term = normalizeSearch(query.trim());
    return library.bookmarks
      .filter(
        (bookmark) =>
          (view === "all" ||
            (view === "favorites"
              ? bookmark.favorite
              : bookmark.collectionId === view)) &&
          (kind === "all" || bookmark.kind === kind) &&
          normalizeSearch(
            [
              bookmark.title,
              bookmark.url,
              bookmark.description,
              bookmark.content,
              bookmark.attachment?.name ?? "",
              collectionsById.get(bookmark.collectionId ?? "")?.name ?? "",
            ].join(" "),
          ).includes(term),
      )
      .sort((a, b) =>
        newest ? b.createdAt - a.createdAt : a.createdAt - b.createdAt,
      );
  }, [library.bookmarks, view, kind, query, newest, collectionsById]);

  const add = useCallback(
    async (text: string) => {
      const collectionId = library.collections.some(
        (collection) => collection.id === view,
      )
        ? view
        : null;
      const result = await api.add(text, collectionId);
      await reload();
      if (result.duplicate || !collectionId) setView("all");
      setQuery("");
      setKind("all");
      setNewest(true);
      setHighlight(result.id);
      notify(result.duplicate ? "Este link já está salvo" : "Link salvo");
      setTimeout(
        () =>
          document
            .getElementById(`bookmark-${result.id}`)
            ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
        100,
      );
    },
    [library.collections, view, reload, notify],
  );

  const capture = useCallback(
    async (
      operation: (collectionId: string | null) => Promise<CaptureResult>,
    ) => {
      if (busyPaste.current) return;
      busyPaste.current = true;
      setPasting(true);
      const collectionId = library.collections.some(
        (collection) => collection.id === view,
      )
        ? view
        : null;
      try {
        const result = await operation(collectionId);
        await reload();
        if (result.items.length) {
          if (!collectionId || result.items.some((item) => item.duplicate))
            setView("all");
          setQuery("");
          setKind("all");
          setNewest(true);
          setHighlight(result.items[0].id);
          const message =
            result.items.length === 1
              ? result.items[0].duplicate
                ? "Este item já está salvo"
                : "Item salvo"
              : `${result.items.length} itens salvos`;
          notify(
            result.errors.length
              ? `${message}. ${result.errors.join("; ")}`
              : message,
            result.errors.length > 0,
          );
        } else if (result.errors.length) notify(result.errors.join("; "), true);
      } catch (error) {
        notify(errorText(error), true);
      } finally {
        busyPaste.current = false;
        setPasting(false);
      }
    },
    [library.collections, view, reload, notify],
  );

  const paste = useCallback(
    (text?: string) =>
      capture((collectionId) => api.capture(collectionId, text)),
    [capture],
  );
  const pickFiles = useCallback(
    () => capture((collectionId) => api.pickFiles(collectionId)),
    [capture],
  );

  useEffect(() => {
    let stopped = false;
    const disposers: (() => void)[] = [];
    const register = async () => {
      for (const name of [
        "tauri://drag-enter",
        "tauri://drag-leave",
        "tauri://drag-drop",
      ] as const) {
        const dispose = await listen<{ paths: string[] }>(name, (event) => {
          if (dialog || pendingDelete || document.querySelector("dialog[open]")) return;
          setDragging(name === "tauri://drag-enter");
          if (name === "tauri://drag-drop")
            void capture((collectionId) =>
              api.files(event.payload.paths, collectionId),
            );
        });
        if (stopped) dispose();
        else disposers.push(dispose);
      }
    };
    void register().catch(() => {});
    return () => {
      stopped = true;
      disposers.forEach((dispose) => dispose());
    };
  }, [capture, dialog, pendingDelete]);

  useEffect(() => {
    const editing = (target: EventTarget | null) =>
      target instanceof Element &&
      !!target.closest("input,textarea,select,[contenteditable='true']");
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        dialog ||
        pendingDelete ||
        document.querySelector("dialog[open]")
      )
        return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        setDialog({ type: event.shiftKey ? "note" : "add" });
      }
      if (
        event.key.toLowerCase() === "v" &&
        !editing(event.target) &&
        !event.repeat
      ) {
        event.preventDefault();
        void paste();
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      if (dialog || pendingDelete || document.querySelector("dialog[open]") || editing(event.target)) return;
      event.preventDefault();
      const text = event.clipboardData?.files.length
        ? undefined
        : event.clipboardData?.getData("text/plain");
      void paste(text || undefined);
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("paste", onPaste);
    };
  }, [paste, dialog, pendingDelete]);

  async function toggleFavorite(bookmark: Bookmark) {
    try {
      await api.favorite(bookmark.id, !bookmark.favorite);
      await reload();
    } catch (error) {
      notify(errorText(error), true);
    }
  }
  async function remove(bookmark: Bookmark) {
    try {
      await api.remove(bookmark.id);
      setPendingDelete(null);
      setDialog(null);
      await reload();
      notify(
        bookmark.kind === "note"
          ? "Nota excluída"
          : bookmark.attachment
            ? "Arquivo excluído"
            : "Link excluído",
        false,
        {
          label: "Desfazer",
          run: () => {
            void api
              .restore(bookmark.id)
              .then(reload)
              .then(() =>
                notify(
                  bookmark.kind === "note"
                    ? "Nota restaurada"
                    : bookmark.attachment
                      ? "Arquivo restaurado"
                      : "Link restaurado",
                ),
              )
              .catch((error) => notify(errorText(error), true));
          },
        },
      );
    } catch (error) {
      notify(errorText(error), true);
    }
  }
  function navigate(next: View) {
    setView(next);
    setQuery("");
    setKind("all");
  }
  async function transfer(direction: "export" | "import") {
    setMenu(false);
    try {
      if (direction === "export") {
        if (await api.export()) notify("Backup exportado");
      } else {
        const count = await api.import();
        if (count !== null) {
          await reload();
          navigate("all");
          notify(
            count === 0
              ? "Todos os itens já estavam na biblioteca"
              : `${count} ${count === 1 ? "item importado" : "itens importados"}`,
          );
        }
      }
    } catch (error) {
      notify(errorText(error), true);
    }
  }

  const selected =
    dialog?.type === "bookmark"
      ? library.bookmarks.find((bookmark) => bookmark.id === dialog.id)
      : undefined;

  return (
    <NoticeContext.Provider value={{ toast, dismiss: () => setToast(null) }}>
      <div className={`app-shell ${isMac ? "macos" : "native-titlebar"}`}>
        <div className="titlebar" data-tauri-drag-region />
        <div className="workspace">
          <aside className="sidebar" aria-label="Navegação">
            <div className="brand">
              <span className="brand-mark">
                <BookmarkIcon />
              </span>
              <span>untab</span>
            </div>
            <nav>
              <button
                className={`nav ${view === "all" ? "active" : ""}`}
                aria-current={view === "all" ? "page" : undefined}
                onClick={() => navigate("all")}
              >
                <LayoutGrid />
                <span>Biblioteca</span>
                <small>{library.bookmarks.length}</small>
              </button>
              <button
                className={`nav ${view === "favorites" ? "active" : ""}`}
                aria-current={view === "favorites" ? "page" : undefined}
                onClick={() => navigate("favorites")}
              >
                <Star />
                <span>Favoritos</span>
                <small>
                  {
                    library.bookmarks.filter((bookmark) => bookmark.favorite)
                      .length
                  }
                </small>
              </button>
            </nav>
            <div className="collections-heading">
              <span>Coleções</span>
              <button
                className="icon-button"
                aria-label="Nova coleção"
                title="Nova coleção"
                onClick={() => setDialog({ type: "collection" })}
              >
                <Plus size={15} />
              </button>
            </div>
            <nav className="collection-list">
              {library.collections.map((collection) => (
                <button
                  key={collection.id}
                  className={`nav ${view === collection.id ? "active" : ""}`}
                  aria-current={view === collection.id ? "page" : undefined}
                  onClick={() => navigate(collection.id)}
                  title={collection.name}
                >
                  <span
                    className="collection-dot"
                    style={{ background: collection.color }}
                  />
                  <span>{collection.name}</span>
                  <small>
                    {
                      library.bookmarks.filter(
                        (bookmark) => bookmark.collectionId === collection.id,
                      ).length
                    }
                  </small>
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom" ref={menuRef}>
              <button
                className={`options-button ${menu ? "active" : ""}`}
                aria-haspopup="menu"
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
              >
                <MoreHorizontal />
                <span>Opções</span>
              </button>
              {menu && (
                <div className="options-menu" role="menu">
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      setDialog({ type: "add" });
                    }}
                  >
                    <Link2 />
                    Adicionar link<kbd>{shortcut("N")}</kbd>
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      setDialog({ type: "collection" });
                    }}
                  >
                    <FolderPlus />
                    Nova coleção
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      void pickFiles();
                    }}
                  >
                    <Paperclip />
                    Adicionar arquivos
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => void transfer("import")}
                  >
                    <Upload />
                    Importar backup
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => void transfer("export")}
                  >
                    <Download />
                    Exportar backup
                  </button>
                </div>
              )}
              <Updates />
            </div>
          </aside>
          <main className="main">
            {dragging && (
              <div className="drop-overlay">
                <Paperclip />
                <span>Solte para salvar</span>
              </div>
            )}
            <header className="heading">
              <div className="heading-copy">
                <h1>{title}</h1>
                <span className="result-count" aria-live="polite">
                  {filtered.length} {filtered.length === 1 ? "item" : "itens"}
                </span>
                {activeCollection && (
                  <button
                    className="icon-button edit-collection"
                    title="Editar coleção"
                    aria-label="Editar coleção"
                    onClick={() =>
                      setDialog({
                        type: "collection",
                        collection: activeCollection,
                      })
                    }
                  >
                    <Pencil size={14} />
                  </button>
                )}
              </div>
              <button
                className="icon-button add-files-button"
                aria-label="Adicionar arquivos"
                title="Adicionar arquivos"
                disabled={pasting || loading || !!loadError}
                onClick={() => void pickFiles()}
              >
                <Paperclip />
              </button>
              <button
                className="secondary new-note-button"
                title={`Nova nota (${shortcut("N", true)})`}
                disabled={loading || !!loadError}
                onClick={() => setDialog({ type: "note" })}
              >
                <StickyNote />
                Nova nota
              </button>
              <button
                className="primary paste-button"
                disabled={pasting || loading || !!loadError}
                onClick={() => void paste()}
                title="Colar texto, imagem ou arquivos"
              >
                {pasting ? <LoaderCircle className="spin" /> : <Clipboard />}
                Colar<kbd>{shortcut("V")}</kbd>
              </button>
            </header>
            <label className="searchbar">
              <Search />
              <input
                ref={search}
                type="search"
                aria-label="Buscar na biblioteca"
                placeholder="Buscar…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                spellCheck={false}
              />
              <kbd>{shortcut("K")}</kbd>
            </label>
            <div className="filterrow">
              <div className="kind-filters" aria-label="Filtrar por tipo">
                {(
                  [
                    "all",
                    "site",
                    "article",
                    "video",
                    "image",
                    "document",
                    "note",
                    "audio",
                    "file",
                  ] as const
                ).map((value) => (
                  <button
                    key={value}
                    className={`chip ${kind === value ? "active" : ""}`}
                    aria-pressed={kind === value}
                    onClick={() => setKind(value)}
                  >
                    {value === "all"
                      ? "Todos"
                      : {
                          site: "Sites",
                          article: "Artigos",
                          video: "Vídeos",
                          image: "Imagens",
                          document: "Documentos",
                          note: "Notas",
                          audio: "Áudios",
                          file: "Arquivos",
                        }[value]}
                  </button>
                ))}
              </div>
              <button
                className="sort"
                title="Inverter ordem"
                onClick={() => setNewest(!newest)}
              >
                <ArrowDownUp />
                <span>{newest ? "Mais recentes" : "Mais antigos"}</span>
              </button>
            </div>
            <div className="surface">
              {loading ? (
                <div className="empty-state">
                  <LoaderCircle
                    className="spin"
                    aria-label="Carregando biblioteca"
                  />
                </div>
              ) : loadError ? (
                <div className="empty-state">
                  <h2>Não foi possível abrir a biblioteca</h2>
                  <p>{loadError}</p>
                  <button
                    className="secondary"
                    onClick={() => {
                      setLoading(true);
                      void reload().catch((error) => {
                        setLoadError(errorText(error));
                        setLoading(false);
                      });
                    }}
                  >
                    <RefreshCw />
                    Tentar novamente
                  </button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <BookmarkIcon />
                  </div>
                  <h2>
                    {library.bookmarks.length === 0
                      ? "Cole algo para guardar"
                      : "Nenhum item encontrado"}
                  </h2>
                  {library.bookmarks.length === 0 ? (
                    <>
                      <p>{shortcut("V")} para salvar</p>
                      <button
                        className="secondary"
                        onClick={() => setDialog({ type: "add" })}
                      >
                        <Plus />
                        Adicionar link
                      </button>
                    </>
                  ) : (
                    (query || kind !== "all") && (
                      <button
                        className="secondary"
                        onClick={() => {
                          setQuery("");
                          setKind("all");
                        }}
                      >
                        Limpar filtros
                      </button>
                    )
                  )}
                </div>
              ) : (
                <div className="grid">
                  {filtered.map((bookmark) => {
                    const collection = collectionsById.get(
                      bookmark.collectionId ?? "",
                    );
                    return (
                      <article
                        id={`bookmark-${bookmark.id}`}
                        key={bookmark.id}
                        className={`card ${highlight === bookmark.id ? "highlight" : ""}`}
                      >
                        <button
                          className="card-content"
                          aria-label={`Ver detalhes: ${bookmark.title}`}
                          onClick={() =>
                            setDialog({ type: "bookmark", id: bookmark.id })
                          }
                        >
                          <Cover bookmark={bookmark} />
                          <div className="card-body">
                            <div className="site">
                              <span className="favicon" aria-hidden="true">
                                {bookmark.kind === "note" ? (
                                  <StickyNote />
                                ) : bookmark.attachment ? (
                                  <Paperclip />
                                ) : (
                                  bookmark.domain[0]?.toUpperCase()
                                )}
                              </span>
                              <span>
                                {bookmark.kind === "note"
                                  ? "Nota"
                                  : bookmark.attachment
                                    ? fileSize(bookmark.attachment.size)
                                    : bookmark.domain}
                              </span>
                            </div>
                            <h2 title={bookmark.title}>{bookmark.title}</h2>
                            <div className="card-footer">
                              <span
                                className="tag"
                                style={
                                  {
                                    "--tag-color":
                                      collection?.color ?? "#858591",
                                  } as CSSProperties
                                }
                              >
                                {collection?.name ?? kindLabels[bookmark.kind]}
                              </span>
                              <time
                                dateTime={new Date(
                                  bookmark.createdAt,
                                ).toISOString()}
                                title={dateFormatter.format(bookmark.createdAt)}
                              >
                                {relativeTime(bookmark.createdAt)}
                              </time>
                            </div>
                          </div>
                        </button>
                        <button
                          className={`bookmark-star ${bookmark.favorite ? "is-favorite" : ""}`}
                          title={
                            bookmark.favorite
                              ? "Remover dos favoritos"
                              : "Favoritar"
                          }
                          aria-label={`${bookmark.favorite ? "Remover dos favoritos" : "Favoritar"}: ${bookmark.title}`}
                          aria-pressed={bookmark.favorite}
                          onClick={() => void toggleFavorite(bookmark)}
                        >
                          <Star />
                        </button>
                        <button
                          className="bookmark-delete"
                          title="Excluir"
                          aria-label={`Excluir: ${bookmark.title}`}
                          onClick={() => setPendingDelete(bookmark)}
                        >
                          <Trash2 />
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </main>
        </div>
        {selected && (
          <BookmarkDetails
            key={selected.id}
            bookmark={selected}
            collections={library.collections}
            close={() => setDialog(null)}
            saved={reload}
            remove={setPendingDelete}
            notify={notify}
          />
        )}
        {dialog?.type === "collection" && (
          <CollectionDialog
            collection={dialog.collection}
            close={() => setDialog(null)}
            save={async (name, color) => {
              if (dialog.collection)
                await api.editCollection(dialog.collection.id, name, color);
              else {
                const id = await api.createCollection(name, color);
                setView(id);
                setQuery("");
                setKind("all");
              }
              await reload();
            }}
            remove={async () => {
              if (dialog.collection) {
                await api.deleteCollection(dialog.collection.id);
                if (view === dialog.collection.id) navigate("all");
                await reload();
                notify("Coleção excluída");
              }
            }}
          />
        )}
        {dialog?.type === "add" && (
          <AddDialog close={() => setDialog(null)} add={add} />
        )}
        {dialog?.type === "note" && (
          <NoteDialog
            close={() => setDialog(null)}
            create={async (title, content) => {
              const result = await api.createNote(
                title,
                content,
                activeCollection?.id ?? null,
              );
              await reload();
              if (!activeCollection) setView("all");
              setQuery("");
              setKind("all");
              setNewest(true);
              setHighlight(result.id);
              notify("Nota salva");
            }}
          />
        )}
        {pendingDelete && (
          <DeleteDialog
            bookmark={pendingDelete}
            close={() => setPendingDelete(null)}
            confirm={() => remove(pendingDelete)}
          />
        )}
        {!dialog && !pendingDelete && <Notice />}
      </div>
    </NoticeContext.Provider>
  );
}
