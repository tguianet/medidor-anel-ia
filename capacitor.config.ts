import type { CapacitorConfig } from "@capacitor/cli";

// App nativo (Android/iOS) do Medidor de Anel.
// Empacota o mesmo site (pasta dist gerada por `npm run build`).
const config: CapacitorConfig = {
  appId: "br.com.tguianet.medidoranel",
  appName: "Medidor de Anel",
  webDir: "dist",
  backgroundColor: "#0d0d0d",
  android: {
    allowMixedContent: false,
  },
};

export default config;
