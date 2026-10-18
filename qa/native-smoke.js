(async () => {
  if (window.__untabSmokeRunning) return;
  window.__untabSmokeRunning = true;
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const checks = [];
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function until(check, name, timeout = 18000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await check()) {
        checks.push(name);
        return;
      }
      await pause(100);
    }
    throw new Error("Timeout: " + name);
  }
  const assert = (value, name) => {
    if (!value) throw new Error(name);
    checks.push(name);
  };
  const library = () => invoke("get_library");
  function setInput(element, value) {
    const prototype =
      element.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(
      element,
      value,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function paste(text) {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  }
  try {
    await until(
      () => document.querySelector(".card, .empty-state h2"),
      "native renderer loaded",
    );
    const previous = await library();
    if (previous.bookmarks.length) {
      assert(
        previous.bookmarks.some((b) => b.title === "Título local verificado"),
        "database survived app restart",
      );
      assert(
        previous.collections.some((c) => c.name === "Teste nativo"),
        "collections survived app restart",
      );
      assert(
        previous.bookmarks.some(
          (b) =>
            b.kind === "note" &&
            b.content === "Texto nativo\n\nSegunda versão com acentuação",
        ),
        "note content survived app restart",
      );
      assert(
        previous.bookmarks.filter((b) => b.attachment).length === 5,
        "five owned files survived restart",
      );
      await invoke("plugin:event|emit", {
        event: "smoke-result",
        payload: { success: true, checks, phase: "restart" },
      });
      return;
    }
    paste("https://example.com/untab-smoke?keep=1#section");
    await until(
      async () => (await library()).bookmarks.length === 1,
      "paste event persisted a real bookmark",
    );
    await until(
      () => document.querySelectorAll(".card").length === 1,
      "saved bookmark rendered",
    );
    const first = (await library()).bookmarks[0];
    assert(
      first.url.endsWith("?keep=1#section"),
      "URL query and fragment retained",
    );
    paste(first.url);
    await pause(400);
    assert(
      (await library()).bookmarks.length === 1,
      "duplicate paste did not add a row",
    );
    paste(" ");
    await until(
      () => document.querySelector('[role="alert"]'),
      "empty paste reported without saving",
    );
    assert(
      (await library()).bookmarks.length === 1,
      "empty clipboard rejected",
    );
    document.querySelector(".bookmark-star").click();
    await until(
      async () => (await library()).bookmarks[0].favorite,
      "favorite persisted",
    );
    const collection = await invoke("create_collection", {
      name: "Teste nativo",
      color: "#a999cd",
    });
    await pause(200);
    document.querySelector(".card-content").click();
    await until(
      () => document.querySelector("dialog[open] #bookmark-title"),
      "details dialog opened",
    );
    setInput(
      document.querySelector("#bookmark-title"),
      "Título local verificado",
    );
    const select = document.querySelector("#bookmark-collection");
    select.value = collection;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await pause(100);
    document.querySelector(".details-form").requestSubmit();
    await until(
      async () =>
        (await library()).bookmarks[0].title === "Título local verificado",
      "edited title persisted through form",
    );
    assert(
      (await library()).bookmarks[0].collectionId === collection,
      "collection assignment persisted",
    );
    const editField = document.querySelector("#bookmark-title");
    editField.focus();
    const fieldPaste = new KeyboardEvent("keydown", {
      key: "v",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    editField.dispatchEvent(fieldPaste);
    assert(
      !fieldPaste.defaultPrevented,
      "Command V inside editor keeps normal text paste",
    );
    document.querySelector('[aria-label="Fechar detalhes"]').click();
    await pause(100);
    const search = document.querySelector(
      '[aria-label="Buscar na biblioteca"]',
    );
    setInput(search, "verificado");
    await until(
      () => document.querySelectorAll(".card").length === 1,
      "search finds custom title",
    );
    setInput(search, "no-such-bookmark");
    await until(
      () => document.querySelectorAll(".card").length === 0,
      "search filters missing titles",
    );
    setInput(search, "");
    await until(
      () => document.querySelectorAll(".card").length === 1,
      "search clearing restores results",
    );
    document.querySelector(".card-content").click();
    await until(
      () => document.querySelector("dialog[open]"),
      "details reopened",
    );
    document.querySelector(".details-actions .danger").click();
    await until(
      () => document.querySelector('dialog[role="alertdialog"][open]'),
      "delete confirmation opened",
    );
    assert(
      (await library()).bookmarks.length === 1,
      "opening confirmation does not delete",
    );
    document.querySelector('dialog[role="alertdialog"] .secondary').click();
    await until(
      () => !document.querySelector('dialog[role="alertdialog"]'),
      "cancel closes only confirmation",
    );
    assert(
      (await library()).bookmarks.length === 1 &&
        document.querySelector(".drawer[open]"),
      "cancel preserves bookmark and detail panel",
    );
    document.querySelector(".details-actions .danger").click();
    await until(
      () => document.querySelector('dialog[role="alertdialog"][open]'),
      "confirmation reopened",
    );
    document.querySelector('dialog[role="alertdialog"] .danger-button').click();
    await until(
      async () => (await library()).bookmarks.length === 0,
      "delete persisted",
    );
    await until(
      () =>
        [...document.querySelectorAll(".toast button")].find(
          (b) => b.textContent === "Desfazer",
        ),
      "undo offered",
    );
    [...document.querySelectorAll(".toast button")]
      .find((b) => b.textContent === "Desfazer")
      .click();
    await until(
      async () => (await library()).bookmarks.length === 1,
      "undo restored bookmark",
    );
    const restoredCollection = await invoke("create_collection", {
      name: "Restaurados",
      color: "#c4a788",
    });
    await invoke("delete_bookmark", { id: first.id });
    const restored = await invoke("add_bookmark", {
      url: first.url,
      collectionId: restoredCollection,
    });
    const recovered = (await library()).bookmarks.find(
      (b) => b.id === first.id,
    );
    assert(
      !restored.duplicate &&
        recovered.collectionId === restoredCollection &&
        recovered.title === "Título local verificado",
      "re-pasting a deleted link restores it into the chosen collection",
    );
    await invoke("add_bookmark", {
      url: "https://ogp.me/",
      collectionId: null,
    });
    await until(
      async () =>
        (await library()).bookmarks.some(
          (b) => b.url === "https://ogp.me/" && b.previewStatus !== "pending",
        ),
      "live metadata request finished",
      45000,
    );
    const og = (await library()).bookmarks.find(
      (b) => b.url === "https://ogp.me/",
    );
    assert(
      og.title.toLowerCase().includes("open graph"),
      "live page title extracted",
    );
    assert(!!og.imagePath, "preview image cached on disk");
    await until(
      () =>
        [...document.querySelectorAll(".cover img")].some(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      "cached image loads through Tauri asset protocol",
    );
    await invoke("refresh_preview", { id: og.id });
    await until(
      async () =>
        (await library()).bookmarks.some(
          (b) =>
            b.id === og.id &&
            b.previewStatus === "ready" &&
            b.imagePath !== og.imagePath,
        ),
      "refresh replaces cached image without stale browser cache",
      45000,
    );
    document.querySelector(".new-note-button").click();
    await until(
      () => document.querySelector("#new-note-content"),
      "new note dialog opened",
    );
    setInput(document.querySelector("#new-note-title"), "Nota nativa");
    setInput(
      document.querySelector("#new-note-content"),
      "Texto nativo\n\nRascunho",
    );
    await pause(100);
    document.querySelector("#new-note-content").closest("form").requestSubmit();
    await until(
      async () =>
        (await library()).bookmarks.some(
          (b) => b.kind === "note" && b.title === "Nota nativa",
        ),
      "note created through native UI",
    );
    await until(
      () => document.querySelector('[aria-label="Ver detalhes: Nota nativa"]'),
      "note card rendered",
    );
    document.querySelector('[aria-label="Ver detalhes: Nota nativa"]').click();
    await until(
      () => document.querySelector("#note-content"),
      "note editor opened",
    );
    setInput(
      document.querySelector("#note-content"),
      "Texto nativo\n\nSegunda versão com acentuação",
    );
    await pause(100);
    document.querySelector(".details-form").requestSubmit();
    await until(
      async () =>
        (await library()).bookmarks.some(
          (b) =>
            b.kind === "note" &&
            b.content === "Texto nativo\n\nSegunda versão com acentuação",
        ),
      "note edits persisted with line breaks",
    );
    assert(
      !document.querySelector("dialog .url-button, dialog .preview-status"),
      "notes have no web-only actions",
    );
    document.querySelector('[aria-label="Fechar detalhes"]').click();
    setInput(search, "acentuacao");
    await until(
      () =>
        document.querySelectorAll(".card").length === 1 &&
        document.querySelector(".note-cover"),
      "search finds note body without accents",
    );
    setInput(search, "");
    assert(
      document.documentElement.scrollWidth <= innerWidth,
      "native layout has no horizontal overflow",
    );
    const report = await invoke("import_files", {
      paths: window.__untabSmokeFiles,
      collectionId: collection,
    });
    assert(
      report.items.length === 5 && report.errors.length === 1,
      "mixed file batch imports safe files and rejects executable",
    );
    const fileItems = (await library()).bookmarks.filter((b) => b.attachment);
    assert(
      fileItems.length === 5 &&
        fileItems.every((b) => b.collectionId === collection),
      "files stored in selected collection",
    );
    const duplicate = await invoke("import_files", {
      paths: [window.__untabSmokeFiles[0]],
      collectionId: null,
    });
    assert(duplicate.items[0].duplicate, "file bytes deduplicated");
    if (window.__untabSmokeClipboard) {
      await invoke("copy_bookmark", { id: duplicate.items[0].id });
      const pasted = await invoke("capture_clipboard", { collectionId: null, text: null });
      assert(pasted.items.length === 1 && pasted.items[0].duplicate,
        "native file clipboard round trip preserves file paths");
    }
    const imageItem = fileItems.find((b) => b.kind === "image");
    const videoItem = fileItems.find((b) => b.kind === "video");
    const pdfItem = fileItems.find(
      (b) => b.attachment.mime === "application/pdf",
    );
    if (window.__untabSmokePlatform === "macos") {
      assert(!!pdfItem.imagePath, "PDF thumbnail generated by macOS");
    }
    assert(!!imageItem.imagePath, "image thumbnail generated");
    await invoke("plugin:event|emit", {
      event: "library-changed",
      payload: null,
    });
    await until(
      () => document.querySelector(`#bookmark-${imageItem.id} .card-content`),
      "file card rendered",
    );
    document.querySelector(`#bookmark-${imageItem.id} .card-content`).click();
    await until(() => {
      const image = document.querySelector(".file-image");
      return image?.complete && image.naturalWidth === 120;
    }, "owned image renders through native asset protocol");
    assert(
      !document.querySelector("dialog .url-button, dialog .preview-status"),
      "file details hide web actions",
    );
    document.querySelector('[aria-label="Fechar detalhes"]').click();
    document.querySelector(`#bookmark-${videoItem.id} .card-content`).click();
    await until(
      () => document.querySelector("video")?.readyState >= 1,
      "local video metadata loads in WebView",
    );
    assert(
      document.querySelector("video").duration > 0,
      "video duration decoded",
    );
    document.querySelector('[aria-label="Fechar detalhes"]').click();
    await invoke("delete_bookmark", { id: pdfItem.id });
    await invoke("restore_bookmark", { id: pdfItem.id });
    assert(
      (await library()).bookmarks.some(
        (b) => b.id === pdfItem.id && b.attachment,
      ),
      "file delete undo preserves attachment",
    );
    await invoke("plugin:event|emit", {
      event: "smoke-result",
      payload: { success: true, checks, phase: "first-run" },
    });
  } catch (error) {
    await invoke("plugin:event|emit", {
      event: "smoke-result",
      payload: {
        success: false,
        checks,
        error: String(error),
        stack: error.stack,
        media: (() => {
          const video = document.querySelector("video");
          return video ? { readyState: video.readyState, networkState: video.networkState,
            error: video.error?.message, h264: video.canPlayType('video/mp4; codecs="avc1.42E01E"') }
            : { fallback: document.querySelector(".media-fallback")?.textContent };
        })(),
      },
    });
  }
})();
