import { useEffect, useRef, useState } from "react";

type Stage = "intro" | "camera" | "review";

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stage, setStage] = useState<Stage>("intro");
  const [photo, setPhoto] = useState("");
  const [error, setError] = useState("");

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => () => stopCamera(), []);

  const openCamera = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador não permite acesso à câmera.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setStage("camera");
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setError("Não foi possível abrir a câmera. Autorize o acesso e tente novamente.");
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    setPhoto(canvas.toDataURL("image/jpeg", 0.92));
    stopCamera();
    setStage("review");
  };

  return (
    <main className="app">
      <header className="brand">
        <span className="mark">◇</span>
        <div><strong>Medidor de Anel</strong><small>Visão computacional</small></div>
      </header>

      {stage === "intro" && (
        <section className="panel intro">
          <span className="step">PASSO 1 DE 2</span>
          <h1>Descubra seu aro usando a câmera</h1>
          <p className="lead">Coloque um cartão padrão e o dedo sobre uma superfície plana. Eles devem ficar lado a lado.</p>
          <div className="example" aria-label="Exemplo de posicionamento">
            <div className="finger"><span /></div>
            <div className="card"><span className="chip" /><small>CARTÃO</small></div>
          </div>
          <ul className="tips">
            <li>Use boa iluminação e evite sombras.</li>
            <li>Deixe os quatro cantos do cartão visíveis.</li>
            <li>Fotografe completamente de cima.</li>
          </ul>
          <button className="primary" onClick={openCamera}>Abrir câmera</button>
          {error && <p className="error">{error}</p>}
          <p className="privacy">A fotografia é processada no seu aparelho.</p>
        </section>
      )}

      {stage === "camera" && (
        <section className="camera-screen">
          <div className="camera-top">
            <button className="icon-button" onClick={() => { stopCamera(); setStage("intro"); }}>×</button>
            <span>Alinhe cartão e dedo</span>
          </div>
          <div className="viewport">
            <video ref={videoRef} playsInline muted />
            <div className="guide">
              <div className="finger-guide">DEDO</div>
              <div className="card-guide">CARTÃO</div>
            </div>
          </div>
          <p>Mantenha o celular paralelo à mesa</p>
          <button className="shutter" onClick={capture} aria-label="Tirar fotografia"><span /></button>
        </section>
      )}

      {stage === "review" && (
        <section className="panel review">
          <span className="step">PASSO 2 DE 2</span>
          <h1>A foto ficou nítida?</h1>
          <div className="preview">{photo && <img src={photo} alt="Fotografia capturada" />}</div>
          <div className="review-actions">
            <button className="secondary" onClick={() => { setPhoto(""); void openCamera(); }}>Tirar outra</button>
            <button className="primary" onClick={() => alert("Próxima etapa: detectar o cartão e calcular a escala.")}>Usar esta foto</button>
          </div>
          <p className="pending">Na próxima fase, o sistema detectará automaticamente o cartão e medirá o dedo.</p>
        </section>
      )}
    </main>
  );
}
