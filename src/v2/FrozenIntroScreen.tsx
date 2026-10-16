import { useEffect, useState } from "react";


// Ícones em SVG (não dependem de fonte externa).
const ICONS: Record<string, string> = {
  token: "M12 2l8 5v10l-8 5-8-5V7l8-5zm0 3.3L6.5 8.7v6.6L12 18.7l5.5-3.4V8.7L12 5.3z",
  straighten: "M3 7h18v10H3V7zm2 2v6h14V9h-1v3h-2V9h-1v2h-2V9h-1v3h-2V9h-1v2H9V9H8v3H6V9H5z",
  verified: "M12 2l2.4 1.8 3 .2.9 2.9 2.4 1.8-1 2.9 1 2.9-2.4 1.8-.9 2.9-3 .2L12 22l-2.4-1.8-3-.2-.9-2.9-2.4-1.8 1-2.9-1-2.9 2.4-1.8.9-2.9 3-.2L12 2zm-1.2 13.6l5.7-5.7-1.4-1.4-4.3 4.3-2.1-2.1-1.4 1.4 3.5 3.5z",
  pan_tool: "M8 5.5a1.5 1.5 0 013 0V11h1V3.5a1.5 1.5 0 013 0V11h1V5.5a1.5 1.5 0 013 0V15c0 3.9-3.1 7-7 7-2.4 0-4.3-1.1-5.7-3.1L3 14.6a1.5 1.5 0 012.5-1.7L8 15.6V5.5z",
  credit_card: "M3 5h18a1 1 0 011 1v12a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1zm1 4v8h16V9H4zm0-2h16V7H4zm2 6h5v2H6v-2z",
  photo_camera: "M9 4h6l1.5 2H20a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2h3.5L9 4zm3 4.5A4.5 4.5 0 1012 17.5a4.5 4.5 0 000-9zm0 2a2.5 2.5 0 110 5 2.5 2.5 0 010-5z",
  center_focus_strong: "M12 8a4 4 0 100 8 4 4 0 000-8zM4 15H2v5a2 2 0 002 2h5v-2H4v-5zm0-11h5V2H4a2 2 0 00-2 2v5h2V4zm16-2h-5v2h5v5h2V4a2 2 0 00-2-2zm0 18h-5v2h5a2 2 0 002-2v-5h-2v5z",
  lock: "M7 10V7a5 5 0 0110 0v3h1a1 1 0 011 1v10a1 1 0 01-1 1H6a1 1 0 01-1-1V11a1 1 0 011-1h1zm2 0h6V7a3 3 0 00-6 0v3z",
  stars: "M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7L12 2z",
};
const Icon = ({ name, className = "" }: { name: string; className?: string }) => (
  <svg className={`home-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">
    <path d={ICONS[name]} fill="currentColor" />
  </svg>
);

type Props = {
  error: string;
  onMeasureFinger: () => void;
  // Toque no "O" do ARO (o pai conta 7 toques para o modo desenvolvedor).
  onSecretTap?: () => void;
  developerMode?: boolean;
};

export default function FrozenIntroScreen({ error, onMeasureFinger, onSecretTap, developerMode = false }: Props) {

  // PWA: botão "Instalar app" (Android) e dica para iPhone.
  type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };
  const getPrompt = () => (window as unknown as { __mdaInstall?: InstallPrompt }).__mdaInstall ?? null;
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(getPrompt);
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true);
  const isIos = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  useEffect(() => {
    const ready = () => setInstallPrompt(getPrompt());
    window.addEventListener("mda-install-ready", ready);
    return () => window.removeEventListener("mda-install-ready", ready);
  }, []);
  const install = async () => {
    const p = installPrompt;
    if (!p) return;
    try {
      await p.prompt();
      await p.userChoice;
    } catch {
      /* usuário cancelou */
    }
    (window as unknown as { __mdaInstall?: Event | null }).__mdaInstall = null;
    setInstallPrompt(null);
  };

  return (
    <section className="home-brand" aria-label="AROVISION">
      <div className="home-brand-logo">
        <img src="/brand/arovision-logo.jpg" width={1296} height={727} alt="AROVISION — seu aro na medida certa" />
        <button type="button" className="home-brand-secret" aria-label="O" onClick={() => onSecretTap?.()} />
      </div>

      <button type="button" className="home-cta" onClick={() => { try { navigator.vibrate?.(25); } catch { /* sem vibração */ } onMeasureFinger(); }}>
        <Icon name="center_focus_strong" />
        Começar medição
      </button>

      {!isStandalone && installPrompt && (
        <button type="button" className="home-install" onClick={() => void install()}>
          <Icon name="photo_camera" /> Instalar o app
        </button>
      )}
      {!isStandalone && !installPrompt && isIos && (
        <p className="home-install-ios">No iPhone: toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong> para instalar o app.</p>
      )}

      {developerMode && <p className="home-dev-flag">Modo desenvolvedor ativo</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
