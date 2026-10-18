import { test, expect, type Page } from "@playwright/test";

async function mount(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as Record<string, any>;
    const now = Date.now();
    state.__testLibrary = {
      collections: [
        { id: "design", name: "Design", color: "#a999cd" },
        { id: "reading", name: "Para ler", color: "#c4a788" },
      ],
      bookmarks: [
        {
          id: "linear",
          url: "https://linear.app/",
          title: "Linear — referência de produto",
          domain: "linear.app",
          kind: "site",
          collectionId: "design",
          favorite: true,
          imagePath: null,
          createdAt: now - 300000,
          previewStatus: "ready",
          description: "Referência de interface e organização de produto",
        },
        {
          id: "spaces",
          url: "https://spaces.example/",
          title: "Espaços que convidam a criar",
          domain: "spaces.example",
          kind: "article",
          collectionId: "reading",
          favorite: false,
          imagePath: "/qa/fixtures/workspace.svg",
          createdAt: now - 600000,
          previewStatus: "ready",
          description: "Luz, materiais e espaços de trabalho",
        },
        {
          id: "type",
          url: "https://type.example/",
          title: "A personalidade da tipografia",
          domain: "type.example",
          kind: "article",
          collectionId: "design",
          favorite: false,
          imagePath: null,
          createdAt: now - 3600000,
          previewStatus: "ready",
          description: "Ritmo, forma e tipografia editorial",
        },
        {
          id: "motion",
          url: "https://video.example/",
          title: "Pequenas interações, grandes detalhes",
          domain: "video.example",
          kind: "video",
          collectionId: "design",
          favorite: true,
          imagePath: null,
          createdAt: now - 7200000,
          previewStatus: "ready",
          description: "Movimento e resposta visual em interfaces",
        },
        {
          id: "rust",
          url: "https://rust-lang.org/",
          title: "Construindo ferramentas com Rust",
          domain: "rust-lang.org",
          kind: "site",
          collectionId: null,
          favorite: false,
          imagePath: null,
          createdAt: now - 86400000,
          previewStatus: "unavailable",
          description: "",
        },
        {
          id: "notes",
          url: "https://notes.example/",
          title: "Um pouco menos de ruído",
          domain: "notes.example",
          kind: "article",
          collectionId: "reading",
          favorite: false,
          imagePath: "/qa/fixtures/forest.svg",
          createdAt: now - 86400001,
          previewStatus: "ready",
          description: "Um ensaio sobre atenção",
        },
      ],
    };
    state.__testClipboard = "https://example.com/new?keep=1#section";
    state.__opened = [];
    const deleted = new Map<string, unknown>();
    let callback = 0;
    const callbacks = new Map<number, Function>();
    state.__TAURI_INTERNALS__ = {
      transformCallback: (fn: Function) => {
        const id = ++callback;
        callbacks.set(id, fn);
        return id;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      convertFileSrc: (path: string) => path,
      invoke: async (command: string, args: Record<string, any> = {}) => {
        const data = state.__testLibrary;
        const bookmark = () =>
          data.bookmarks.find((b: any) => b.id === args.id);
        if (command === "plugin:event|listen") return ++callback;
        if (command === "plugin:event|unlisten") return;
        if (command === "runtime_info") return { version: "0.4.0", updaterSupported: state.__updaterSupported ?? true };
        if (command === "prepare_update") {
          if (state.__backupError) throw "Disk full";
          state.__backupCreated = true;
          return "update-backups/pre-update-test.untab";
        }
        if (command === "plugin:updater|check") {
          if (state.__updateError) throw "Network unavailable";
          return state.__update ?? null;
        }
        if (command === "plugin:updater|download_and_install") {
          if (!state.__backupCreated) throw "Backup must finish before installation";
          state.__updateInstalls = (state.__updateInstalls ?? 0) + 1;
          if (state.__installError) throw "Invalid signature";
          return;
        }
        if (command === "plugin:resources|close") return;
        if (command === "plugin:process|restart") { state.__restarted = true; return; }
        if (command === "get_library") return structuredClone(data);
        if (command === "read_clipboard") return state.__testClipboard;
        if (command === "capture_clipboard") {
          if (state.__testFiles)
            return state.__TAURI_INTERNALS__.invoke("import_files", {
              collectionId: args.collectionId,
            });
          const text = args.text ?? state.__testClipboard;
          if (!text.trim()) throw "Escreva uma nota com até 100.000 caracteres";
          const item = /^https?:\/\//.test(text)
            ? await state.__TAURI_INTERNALS__.invoke("add_bookmark", {
                url: text,
                collectionId: args.collectionId,
              })
            : await state.__TAURI_INTERNALS__.invoke("create_note", {
                title: "",
                content: text,
                collectionId: args.collectionId,
              });
          return { items: [item], errors: [] };
        }
        if (command === "import_files" || command === "pick_files") {
          const items = [];
          const errors = [];
          for (const file of state.__testFiles ?? []) {
            if (file.name.endsWith(".exe")) {
              errors.push(`${file.name}: Executáveis não são aceitos`);
              continue;
            }
            const existing = data.bookmarks.find(
              (b: any) => b.attachment?.sha256 === file.sha256,
            );
            if (existing) {
              items.push({ id: existing.id, duplicate: true });
              continue;
            }
            const id = crypto.randomUUID();
            data.bookmarks.unshift({
              id,
              url: `untab:file/${file.sha256}`,
              title: file.name,
              domain: "",
              kind: file.kind,
              collectionId: args.collectionId,
              favorite: false,
              imagePath: file.preview ?? null,
              content: "",
              description: "",
              createdAt: Date.now(),
              previewStatus: "ready",
              attachment: file,
            });
            items.push({ id, duplicate: false });
          }
          return { items, errors };
        }
        if (command === "save_file") {
          state.__savedFile = bookmark().attachment;
          return true;
        }
        if (command === "reveal_file") {
          state.__revealedFile = bookmark().attachment;
          return;
        }

        if (command === "set_favorite") {
          bookmark().favorite = args.favorite;
          return;
        }
        if (command === "edit_bookmark") {
          bookmark().title = args.title;
          bookmark().collectionId = args.collectionId;
          return;
        }
        if (command === "create_note") {
          const id = crypto.randomUUID();
          data.bookmarks.unshift({
            id,
            url: `untab:note/${id}`,
            title: args.title || args.content.trim().split("\n")[0],
            content: args.content,
            description: "",
            domain: "",
            kind: "note",
            collectionId: args.collectionId,
            favorite: false,
            imagePath: null,
            createdAt: Date.now(),
            previewStatus: "ready",
          });
          return { id, duplicate: false };
        }
        if (command === "edit_note") {
          Object.assign(bookmark(), {
            title: args.title,
            content: args.content,
            collectionId: args.collectionId,
          });
          return;
        }
        if (command === "delete_bookmark") {
          deleted.set(args.id, bookmark());
          data.bookmarks = data.bookmarks.filter((b: any) => b.id !== args.id);
          return;
        }
        if (command === "restore_bookmark") {
          data.bookmarks.push(deleted.get(args.id));
          return;
        }
        if (command === "open_bookmark") {
          if (state.__openError) throw "Não foi possível abrir o item";
          state.__opened.push(bookmark().url);
          return;
        }
        if (command === "copy_bookmark") {
          state.__testClipboard =
            bookmark().kind === "note"
              ? bookmark().content
              : (bookmark().attachment ?? bookmark().url);
          return;
        }
        if (command === "refresh_preview") {
          bookmark().previewStatus = "pending";
          return;
        }
        if (command === "create_collection") {
          const id = crypto.randomUUID();
          data.collections.push({ id, name: args.name, color: args.color });
          return id;
        }
        if (command === "edit_collection") {
          Object.assign(
            data.collections.find((c: any) => c.id === args.id),
            { name: args.name, color: args.color },
          );
          return;
        }
        if (command === "delete_collection") {
          data.collections = data.collections.filter(
            (c: any) => c.id !== args.id,
          );
          data.bookmarks.forEach((b: any) => {
            if (b.collectionId === args.id) b.collectionId = null;
          });
          return;
        }
        if (command === "add_bookmark") {
          let url: URL;
          try {
            url = new URL(args.url.trim());
          } catch {
            throw "Copie um link válido para colar";
          }
          if (!["http:", "https:"].includes(url.protocol))
            throw "Use um link HTTP ou HTTPS";
          const existing = data.bookmarks.find((b: any) => b.url === url.href);
          if (existing) return { id: existing.id, duplicate: true };
          const id = crypto.randomUUID();
          data.bookmarks.unshift({
            id,
            url: url.href,
            domain: url.hostname,
            title: url.hostname,
            description: "",
            kind: "site",
            collectionId: args.collectionId,
            favorite: false,
            imagePath: null,
            createdAt: Date.now(),
            previewStatus: "pending",
          });
          return { id, duplicate: false };
        }
        throw new Error("Unexpected native command: " + command);
      },
    };
  });
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(6);
}

async function openDetails(page: Page, title: string) {
  await page.getByRole("button", { name: `Abrir: ${title}`, exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Editar detalhes", exact: true }).click();
}

test("captures with Command V, deduplicates, and respects text fields", async ({
  page,
}) => {
  await mount(page);
  await page.keyboard.press("Meta+v");
  await expect(page.locator(".card")).toHaveCount(7);
  await expect(page.getByRole("status")).toContainText("Item salvo");
  await page.keyboard.press("Meta+v");
  await expect(page.getByRole("status")).toContainText("já está salvo");
  await expect(page.locator(".card")).toHaveCount(7);
  const prevented = await page.getByRole("searchbox").evaluate((input) => {
    const event = new KeyboardEvent("keydown", {
      key: "v",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await page.evaluate(() => {
    (window as any).__testClipboard = " ";
  });
  await page.keyboard.press("Meta+v");
  await expect(page.getByRole("alert")).toContainText("Escreva uma nota");
  await expect(page.locator(".card")).toHaveCount(7);
});

test("captures files and plain text, handles partial failures, and preserves file actions", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => {
    (window as any).__testClipboard = "Uma ideia colada\nCom outra linha";
  });
  await page.keyboard.press("Meta+v");
  await expect(page.locator(".note-cover")).toContainText("Com outra linha");
  await page.evaluate(() => {
    (window as any).__testFiles = [
      {
        name: "Foto de referência.png",
        path: "/qa/fixtures/workspace.svg",
        mime: "image/png",
        kind: "image",
        size: 81234,
        sha256: "photo",
        preview: "/qa/fixtures/workspace.svg",
      },
      {
        name: "Manual.pdf",
        path: "/manual.pdf",
        mime: "application/pdf",
        kind: "document",
        size: 51200,
        sha256: "pdf",
      },
      {
        name: "instalador.exe",
        path: "/instalador.exe",
        kind: "file",
        sha256: "exe",
      },
    ];
  });
  await page
    .getByRole("button", { name: "Adicionar arquivos", exact: true })
    .click();
  await expect(page.locator(".card")).toHaveCount(9);
  await expect(page.getByRole("alert")).toContainText("2 itens salvos");
  await expect(page.getByRole("alert")).toContainText("Executáveis");
  await page.keyboard.press("Meta+v");
  await expect(page.locator(".card")).toHaveCount(9);
  await openDetails(page, "Foto de referência.png");
  await expect(page.locator(".file-image")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Abrir arquivo", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copiar arquivo", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".url-button, .preview-status")).toHaveCount(0);
  await page.getByRole("button", { name: "Salvar como…", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__savedFile.name)).toBe(
    "Foto de referência.png",
  );
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Confirmar exclusão" }),
  ).toBeVisible();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Excluir", exact: true })
    .click();
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await page.getByRole("button", { name: "Documentos", exact: true }).click();
  await expect(page.locator(".card")).toHaveCount(1);
  await page.getByRole("button", { name: "Todos", exact: true }).click();
  await page.setViewportSize({ width: 760, height: 560 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".qa/untab-files.png" });
});

test("searches, filters, and maintains collection views", async ({ page }) => {
  await mount(page);
  await page.getByRole("searchbox").fill("tipografia");
  await expect(page.locator(".card")).toHaveCount(1);
  await page.getByRole("searchbox").fill("");
  await page.getByRole("button", { name: "Vídeos", exact: true }).click();
  await expect(page.locator(".card")).toHaveCount(1);
  await page.getByRole("button", { name: "Design 3", exact: true }).click();
  await expect(page.locator(".card")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Colar", exact: false })
    .first()
    .click();
  await expect(page.locator(".card")).toHaveCount(4);
  await expect(
    page.getByRole("heading", { name: "Design", exact: true }),
  ).toBeVisible();
});

test("switches views without resetting filters or order and remembers the choice", async ({ page }) => {
  await mount(page);
  const grid = page.getByRole("button", { name: "Visualização em grade", exact: true });
  const list = page.getByRole("button", { name: "Visualização em lista", exact: true });
  await expect(grid).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Design 3", exact: true }).click();
  await page.getByRole("button", { name: "Artigos", exact: true }).click();
  await page.getByRole("searchbox").fill("tipografia");
  await list.click();
  await expect(list).toHaveAttribute("aria-pressed", "true");
  await expect(grid).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".bookmark-list .card")).toHaveCount(1);
  await expect(page.locator(".card h2")).toHaveText("A personalidade da tipografia");
  await grid.click();
  await expect(page.locator(".grid .card")).toHaveCount(1);
  await expect(page.getByRole("searchbox")).toHaveValue("tipografia");
  await expect(page.getByRole("button", { name: "Artigos", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("searchbox").fill("");
  await page.getByRole("button", { name: "Todos", exact: true }).click();
  await page.getByTitle("Inverter ordem").click();
  const orderedTitles = await page.locator(".card h2").allTextContents();
  await list.click();
  await expect(page.locator(".bookmark-list .card h2")).toHaveText(orderedTitles);
  await expect(page.getByRole("heading", { name: "Design", exact: true })).toBeVisible();
  await page.reload();
  await expect(list).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".bookmark-list .card")).toHaveCount(6);
  await page.screenshot({ path: ".qa/untab-list.png" });
  await grid.click();
  await page.reload();
  await expect(grid).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".grid .card")).toHaveCount(6);
});

test("list rows support keyboard actions, notes, attachments and small windows", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Visualização em lista", exact: true }).click();
  const linear = page.locator("#bookmark-linear");
  await linear.getByRole("button", { name: "Abrir:", exact: false }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as any).__opened)).toEqual(["https://linear.app/"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menuitem", { name: "Abrir no navegador" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Detalhes do bookmark" })).toBeVisible();
  await page.getByRole("button", { name: "Fechar detalhes" }).click();
  await linear.locator(".bookmark-star").focus();
  await page.keyboard.press("Space");
  await expect(linear.locator(".bookmark-star")).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Tab");
  await expect(linear.locator(".bookmark-delete")).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(linear).toHaveCount(0);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(linear).toBeVisible();
  await page.evaluate(() => {
    (window as any).__testClipboard = "Uma nota com título longo ".repeat(12);
  });
  await page.getByRole("button", { name: "Colar", exact: false }).click();
  await page.evaluate(() => {
    (window as any).__testFiles = [{
      name: "Documento de referência.pdf",
      path: "/qa/fixtures/document.pdf",
      mime: "application/pdf",
      kind: "document",
      size: 51200,
      sha256: "list-pdf",
    }];
  });
  await page.getByRole("button", { name: "Adicionar arquivos", exact: true }).click();
  await expect(page.locator(".bookmark-list .card")).toHaveCount(8);
  await expect(page.locator(".bookmark-list .note-cover")).toBeVisible();
  await expect(page.locator(".bookmark-list .card").filter({ hasText: "Documento de referência.pdf" })).toContainText("50.0 KB");
  await page.setViewportSize({ width: 760, height: 560 });
  expect(await page.locator(".surface").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const rows = await page.locator(".bookmark-list .card").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, width: rect.width, height: rect.height };
  }));
  expect(rows.every((row) => row.x === rows[0].x && row.width === rows[0].width && row.height < 100)).toBe(true);
  await page.screenshot({ path: ".qa/untab-list-minimum-window.png" });
  await page.getByRole("searchbox").fill("sem resultado");
  await expect(page.getByRole("heading", { name: "Nenhum item encontrado" })).toBeVisible();
  await page.getByRole("button", { name: "Limpar filtros", exact: true }).click();
  await expect(page.locator(".bookmark-list .card")).toHaveCount(8);
});

test("view switching remains usable when preference storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error("Storage blocked"); };
    Storage.prototype.setItem = () => { throw new Error("Storage blocked"); };
  });
  await mount(page);
  await page.getByRole("button", { name: "Visualização em lista", exact: true }).click();
  await expect(page.locator(".bookmark-list .card")).toHaveCount(6);
  await page.getByRole("button", { name: "Visualização em grade", exact: true }).click();
  await expect(page.locator(".grid .card")).toHaveCount(6);
});

for (const view of ["grade", "lista"]) {
  test(`opens links directly and exposes contextual actions in ${view}`, async ({ page }) => {
    await mount(page);
    await page.getByRole("button", { name: `Visualização em ${view}`, exact: true }).click();
    const item = page.getByRole("button", { name: "Abrir: Linear — referência de produto", exact: true });
    await item.click();
    await expect.poll(() => page.evaluate(() => (window as any).__opened)).toEqual(["https://linear.app/"]);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await item.click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("menuitem")).toHaveText([
      "Abrir no navegador", "Editar detalhes", "Copiar link",
      "Remover dos favoritos", "Atualizar prévia", "Excluir",
    ]);
    expect(await page.evaluate(() => (window as any).__opened.length)).toBe(1);
    await page.getByRole("menuitem", { name: "Copiar link", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).__testClipboard)).toBe("https://linear.app/");
    await item.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Remover dos favoritos", exact: true }).click();
    await expect(page.locator("#bookmark-linear .bookmark-star")).toHaveAttribute("aria-pressed", "false");
    await item.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Atualizar prévia", exact: true }).click();
    await item.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Atualizar prévia", exact: true })).toBeDisabled();
    await page.keyboard.press("End");
    await expect(page.getByRole("menuitem", { name: "Excluir", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("menuitem", { name: "Favoritar", exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.getByRole("menuitem", { name: "Abrir no navegador" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(item).toBeFocused();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Excluir", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(item).toBeVisible();
    await item.click({ button: "right" });
    await page.getByRole("searchbox").click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.evaluate(() => { (window as any).__openError = true; });
    await item.click();
    await expect(page.getByRole("alert")).toContainText("Não foi possível abrir o item");
  });
}

test("file context menus reveal, save, copy and delete the saved file", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Visualização em lista", exact: true }).click();
  await page.evaluate(() => {
    (window as any).__testFiles = [{
      name: "Manual.pdf", path: "/qa/fixtures/document.pdf", mime: "application/pdf",
      kind: "document", size: 51200, sha256: "context-pdf",
    }];
  });
  await page.getByRole("button", { name: "Adicionar arquivos", exact: true }).click();
  const item = page.getByRole("button", { name: "Abrir: Manual.pdf", exact: true });
  await item.click();
  await expect.poll(() => page.evaluate(() => (window as any).__opened)).toEqual(["untab:file/context-pdf"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await item.click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveText([
    "Abrir arquivo", "Editar detalhes", "Copiar arquivo", "Salvar como…",
    "Abrir local do arquivo", "Favoritar", "Excluir",
  ]);
  await page.screenshot({ path: ".qa/untab-file-context-menu.png" });
  await page.getByRole("menuitem", { name: "Abrir local do arquivo", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__revealedFile?.path)).toBe("/qa/fixtures/document.pdf");
  await item.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Salvar como…", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__savedFile?.name)).toBe("Manual.pdf");
  await item.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copiar arquivo", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__testClipboard?.sha256)).toBe("context-pdf");
  await item.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Excluir", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(item).toHaveCount(0);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(item).toBeVisible();
});

test("note menus keep editing and copying available without file or web actions", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => { (window as any).__testClipboard = "Minha nota contextual"; });
  await page.getByRole("button", { name: "Colar", exact: false }).click();
  const item = page.getByRole("button", { name: "Editar nota: Minha nota contextual", exact: true });
  await item.click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveText(["Editar nota", "Copiar texto", "Favoritar", "Excluir"]);
  await page.getByRole("menuitem", { name: "Copiar texto", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Texto copiado");
  await item.click();
  await expect(page.getByRole("dialog", { name: "Editar nota", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__opened)).toEqual([]);
});

test("context menus fit the viewport and dismiss on scrolling or switching items", async ({ page }) => {
  await mount(page);
  await page.setViewportSize({ width: 760, height: 560 });
  const item = page.getByRole("button", { name: "Abrir: Linear — referência de produto", exact: true });
  await item.evaluate((button) => button.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true, cancelable: true, clientX: 755, clientY: 555,
  })));
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(8);
  expect(bounds.y).toBeGreaterThanOrEqual(8);
  expect(bounds.x + bounds.width).toBeCloseTo(752);
  expect(bounds.y + bounds.height).toBeCloseTo(552);
  await page.screenshot({ path: ".qa/untab-context-menu-minimum-window.png" });
  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
  await expect(item).toBeFocused();
  await item.click({ button: "right" });
  await page.locator(".surface").evaluate((surface) => { surface.scrollTop = 100; });
  await expect(menu).toHaveCount(0);
  await item.click({ button: "right" });
  await page.getByRole("button", { name: "Abrir: Espaços que convidam a criar", exact: true }).click({ button: "right" });
  await expect(menu).toHaveCount(1);
  await expect(menu).toHaveAccessibleName("Ações: Espaços que convidam a criar");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => (window as any).__opened)).toEqual([]);
});

test("requires confirmation from cards and preserves edits when cancelling", async ({
  page,
}) => {
  await mount(page);
  const trash = page.getByRole("button", {
    name: "Excluir: Linear — referência de produto",
    exact: true,
  });
  await page.locator("#bookmark-linear").hover();
  await trash.click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Confirmar exclusão",
  });
  await expect(confirmation).toContainText("Linear — referência de produto");
  await expect(
    confirmation.getByRole("button", { name: "Cancelar" }),
  ).toBeFocused();
  await expect(page.locator(".card")).toHaveCount(6);
  await page.screenshot({ path: ".qa/untab-delete-confirmation.png" });
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator(".card")).toHaveCount(6);
  await page.locator("#bookmark-linear").hover();
  await trash.click();
  await page.mouse.click(5, 5);
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator(".card")).toHaveCount(6);
  await openDetails(page, "Linear — referência de produto");
  await page
    .getByLabel("Título", { exact: true })
    .fill("Rascunho ainda não salvo");
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await confirmation.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByLabel("Título", { exact: true })).toHaveValue(
    "Rascunho ainda não salvo",
  );
  await page.getByRole("button", { name: "Fechar detalhes" }).click();
  await page.locator("#bookmark-linear").hover();
  await trash.click();
  await confirmation
    .getByRole("button", { name: "Excluir", exact: true })
    .click();
  await expect(page.locator(".card")).toHaveCount(5);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(page.locator(".card")).toHaveCount(6);
});

test("edits, opens, deletes and restores through the detail panel", async ({
  page,
}) => {
  await mount(page);
  await openDetails(page, "Linear — referência de produto");
  await page.getByLabel("Título", { exact: true }).fill("Minha referência");
  await page.getByLabel("Coleção", { exact: true }).selectOption("reading");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("status")).toContainText("Alterações salvas");
  await page
    .getByRole("button", { name: "Abrir no navegador", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).__opened)).toEqual([
    "https://linear.app/",
  ]);
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Confirmar exclusão" }),
  ).toBeVisible();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Excluir", exact: true })
    .click();
  await expect(page.locator(".card")).toHaveCount(5);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(page.locator(".card")).toHaveCount(6);
  await expect(
    page.getByRole("heading", { name: "Minha referência", exact: true }),
  ).toBeVisible();
});

test("creates a collection and keeps the approved dark layout", async ({
  page,
}) => {
  await mount(page);
  await page.screenshot({ path: ".qa/untab-desktop.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Nova coleção", exact: true }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Projetos");
  await page
    .getByRole("button", { name: "Criar coleção", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Projetos", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Nenhum item encontrado", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 760, height: 560 });
  await page.getByRole("button", { name: "Biblioteca 6", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".qa/untab-minimum-window.png" });
});

test("creates, searches, edits, copies and restores plain text notes", async ({
  page,
}) => {
  await mount(page);
  await page.keyboard.press("Meta+Shift+n");
  const dialog = page.getByRole("dialog", { name: "Nova nota", exact: true });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Título", { exact: true })
    .fill("Ideias para o projeto");
  const body =
    "  Texto com acentuação\n\nPreservar espaços e pesquisar jabuticaba  \n";
  await dialog.getByLabel("Texto", { exact: true }).fill(body);
  await dialog.getByRole("button", { name: "Salvar nota" }).click();
  await expect(page.locator(".card")).toHaveCount(7);
  await page.getByRole("searchbox").fill("jabuticaba");
  await expect(page.locator(".card")).toHaveCount(1);
  await page.getByRole("button", { name: "Notas", exact: true }).click();
  await expect(page.locator(".card .note-cover")).toHaveCount(1);
  await page
    .getByRole("button", {
      name: "Editar nota: Ideias para o projeto",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog", { name: "Editar nota" })).toBeVisible();
  await expect(page.getByLabel("Texto", { exact: true })).toHaveValue(body);
  await expect(
    page.getByRole("button", { name: "Abrir no navegador", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Atualizar prévia", exact: true }),
  ).toHaveCount(0);
  const edited = body + "Segunda versão";
  await page.getByLabel("Texto", { exact: true }).fill(edited);
  await page.getByLabel("Coleção", { exact: true }).selectOption("design");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("status")).toContainText("Alterações salvas");
  await page.getByRole("button", { name: "Copiar texto", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__testClipboard)).toBe(
    edited,
  );
  await page.getByRole("button", { name: "Favoritar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remover dos favoritos", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Confirmar exclusão" }),
  ).toBeVisible();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Excluir", exact: true })
    .click();
  await expect(page.locator(".card")).toHaveCount(0);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(page.locator(".card")).toHaveCount(1);
  await page.setViewportSize({ width: 760, height: 560 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".qa/untab-notes.png" });
});

test("updates require confirmation and failed installs keep the library", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const state = window as unknown as Record<string, any>;
    state.__update = { rid: 9, version: "0.5.0", currentVersion: "0.4.0", body: "Fixes and improvements" };
  });
  await page.getByRole("button", { name: "Atualizações", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Atualizações", exact: true });
  await expect(dialog.getByText("A versão 0.5.0 está disponível.")).toBeVisible();
  await page.keyboard.press("Control+n");
  await expect(page.getByRole("dialog", { name: "Adicionar link", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__updateInstalls ?? 0)).toBe(0);
  await page.getByRole("button", { name: "Atualizar para 0.5.0" }).click();
  await page.evaluate(() => { (window as any).__backupError = true; });
  await dialog.getByRole("button", { name: "Atualizar e reiniciar" }).click();
  await expect(dialog.getByText(/Não foi possível criar o backup/)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__updateInstalls ?? 0)).toBe(0);
  await page.evaluate(() => { (window as any).__backupError = false; });
  await dialog.getByRole("button", { name: "Tentar novamente" }).click();
  await page.evaluate(() => { (window as any).__installError = true; });
  await dialog.getByRole("button", { name: "Atualizar e reiniciar" }).click();
  await expect(dialog.getByText(/Não foi possível concluir/)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__restarted ?? false)).toBe(false);
  expect(await page.evaluate(() => (window as any).__testLibrary.bookmarks.length)).toBe(6);
  await page.evaluate(() => { (window as any).__installError = false; });
  await dialog.getByRole("button", { name: "Tentar novamente" }).click();
  await dialog.getByRole("button", { name: "Atualizar e reiniciar" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__restarted)).toBe(true);
});

test("updates recover after network failure and explain Linux package updates", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => { (window as any).__updateError = true; });
  await page.getByRole("button", { name: "Atualizações", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Atualizações", exact: true });
  await expect(dialog.getByText(/Confira sua conexão/)).toBeVisible();
  await page.evaluate(() => { (window as any).__updateError = false; });
  await dialog.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(dialog.getByText("Você está na versão mais recente.")).toBeVisible();
  await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.evaluate(() => { (window as any).__updaterSupported = false; });
  await page.getByRole("button", { name: "Atualizações", exact: true }).click();
  await expect(dialog.getByText(/instale o novo .deb/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Atualizar e reiniciar" })).toHaveCount(0);
});
