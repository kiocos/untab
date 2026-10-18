import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ArrowDownToLine, LoaderCircle, X } from "lucide-react";

type Runtime = { version: string; updaterSupported: boolean };
type Phase = "idle" | "checking" | "available" | "current" | "installing" | "error" | "restart";

export function Updates() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState("");
  const [progress, setProgress] = useState<number | undefined>();
  const dialog = useRef<HTMLDialogElement>(null);
  const update = useRef<Update | null>(null);
  const busy = useRef(false);

  async function refresh() {
    if (busy.current) return;
    busy.current = true;
    setPhase("checking");
    try {
      const info = await invoke<Runtime>("runtime_info");
      setRuntime(info);
      if (!info.updaterSupported) {
        setPhase("idle");
        return;
      }
      await update.current?.close();
      update.current = null;
      update.current = await check({ timeout: 15000 });
      setVersion(update.current?.version ?? "");
      setPhase(update.current ? "available" : "current");
    } catch {
      setMessage("Não foi possível verificar as atualizações. Confira sua conexão e tente novamente.");
      setPhase("error");
    } finally {
      busy.current = false;
    }
  }

  useEffect(() => {
    void refresh();
    return () => { void update.current?.close().catch(() => {}); };
  }, []);

  async function install() {
    if (!update.current || busy.current) return;
    busy.current = true;
    setPhase("installing");
    setProgress(undefined);
    let downloaded = 0;
    let total = 0;
    let installed = false;
    try {
      await update.current.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total) setProgress(Math.min(100, Math.round(downloaded / total * 100)));
        }
        if (event.event === "Finished") setProgress(100);
      }, { timeout: 180000 });
      installed = true;
      setPhase("restart");
      setMessage("Atualização instalada. Reinicie o Untab para concluir.");
      await relaunch();
    } catch {
      if (!installed) {
        setMessage("Não foi possível concluir a atualização. Seus itens continuam salvos. Tente novamente.");
        setPhase("error");
      }
    } finally {
      busy.current = false;
    }
  }

  function open() {
    dialog.current?.showModal();
    if (phase !== "available" && phase !== "installing" && phase !== "restart") void refresh();
  }

  return <>
    <button className={`options-button update-button ${phase === "available" ? "available" : ""}`} onClick={open}>
      <ArrowDownToLine />
      <span>{phase === "available" ? `Atualizar para ${version}` : "Atualizações"}</span>
    </button>
    <dialog ref={dialog} className="modal update-dialog" aria-label="Atualizações" onCancel={(event) => {
      if (phase === "installing") event.preventDefault();
    }}>
      <div className="modal-header">
        <h2>Atualizações</h2>
        <button className="icon-button" aria-label="Fechar atualizações" disabled={phase === "installing"} onClick={() => dialog.current?.close()}><X /></button>
      </div>
      {runtime && <p className="update-version">Untab {runtime.version}</p>}
      <div className="update-status" role="status" aria-live="polite">
        {phase === "checking" && <p><LoaderCircle className="spin" /> Verificando atualizações…</p>}
        {runtime?.updaterSupported === false && <p>Para atualizar este pacote Linux, instale o novo .deb da página de releases. A versão AppImage permite atualizar por aqui.</p>}
        {phase === "current" && <p>Você está na versão mais recente.</p>}
        {phase === "available" && <>
          <p>A versão {version} está disponível.</p>
          <p>O Untab será reiniciado. Sua biblioteca será mantida.</p>
          {update.current?.body && <pre className="update-notes">{update.current.body}</pre>}
        </>}
        {(phase === "error" || phase === "restart") && <p>{message}</p>}
        {phase === "installing" && <>
          <p>{progress === 100 ? "Instalando…" : "Baixando atualização…"}</p>
          <progress max={100} value={progress} aria-label="Progresso da atualização" />
        </>}
      </div>
      <div className="modal-actions">
        <button className="secondary" disabled={phase === "installing"} onClick={() => dialog.current?.close()}>Fechar</button>
        {phase === "available" && <button className="primary" onClick={() => void install()}>Atualizar e reiniciar</button>}
        {phase === "error" && <button className="primary" onClick={() => void refresh()}>Tentar novamente</button>}
        {phase === "restart" && <button className="primary" onClick={() => void relaunch().catch(() => {})}>Reiniciar</button>}
      </div>
    </dialog>
  </>;
}
