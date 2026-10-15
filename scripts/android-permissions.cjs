// Adiciona a permissão de câmera no AndroidManifest.xml gerado pelo Capacitor.
// Rodado automaticamente por `npm run android:setup`.
const fs = require("fs");
const path = require("path");

const manifest = path.join(__dirname, "..", "android", "app", "src", "main", "AndroidManifest.xml");
if (!fs.existsSync(manifest)) {
  console.error("AndroidManifest.xml não encontrado. Rode antes: npx cap add android");
  process.exit(1);
}
let xml = fs.readFileSync(manifest, "utf8");
const lines = [
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
  '<uses-feature android:name="android.hardware.camera.flash" android:required="false" />',
];
let changed = false;
for (const line of lines) {
  const key = line.match(/android:name="([^"]+)"/)[1];
  if (!xml.includes(key)) {
    xml = xml.replace("</manifest>", `    ${line}\n</manifest>`);
    changed = true;
  }
}
// O app só funciona em pé.
if (!xml.includes("android:screenOrientation")) {
  xml = xml.replace(/<activity(\s)/, '<activity android:screenOrientation="portrait"$1');
  changed = true;
}
fs.writeFileSync(manifest, xml);
console.log(changed ? "Permissão de câmera adicionada ao AndroidManifest.xml" : "AndroidManifest.xml já estava pronto");
