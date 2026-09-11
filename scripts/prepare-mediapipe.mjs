import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceWasm = resolve(root, "node_modules/@mediapipe/tasks-vision/wasm");
const targetRoot = resolve(root, "public/mediapipe");
const targetWasm = resolve(targetRoot, "wasm");
const targetModel = resolve(targetRoot, "hand_landmarker.task");

mkdirSync(targetRoot, { recursive: true });
cpSync(sourceWasm, targetWasm, { recursive: true });

if (!existsSync(targetModel)) {
  const modelUrl = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error(`Falha ao baixar modelo da mão: ${response.status}`);
  writeFileSync(targetModel, Buffer.from(await response.arrayBuffer()));
}

console.log("MediaPipe e modelo preparados para publicação local.");
