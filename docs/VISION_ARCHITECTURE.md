# Arquitetura de visão anterior à fórmula de aro

## Regra de preservação

A conversão final continua em `src/v2/ringClassifier.ts`, por meio de
`classifyFingerWidthMm(measuredWidthMm)`.

Esta camada NÃO altera:
- `MANUAL_FINGER_CURVE`;
- limites de classificação;
- offsets de aro;
- justo/exato/conforto.

Fluxo preservado:

```
câmera
-> validação de captura
-> cartão
-> perspectiva
-> bordas do dedo
-> largura em mm
-> confiança
-> classifyFingerWidthMm(...)
-> aro
```

## Pontos atuais do código

### Calibração do cartão
- `src/vision.ts`: localização inicial do cartão e guia ao vivo.
- `src/v2/AppV2.tsx`: confirmação das linhas do cartão, quadrilátero e homografia.
- `src/v2/cardCalibration.ts`: referência física de 85,60 mm.

### Pixel -> milímetro
- `src/v2/measurementPipeline.ts`: conversão isolada de pixels em mm.
- `src/v2/AppV2.tsx`: quando homografia está disponível, os pontos do dedo são projetados para o plano físico do cartão antes de medir.

### Medição do dedo
- `src/v2/AppV2.tsx`: `fingerBandSamplesPx()`.
- Os cortes já corrigem a direção transversal pela inclinação estimada do eixo do dedo.
- A Fase 1 adiciona estatística robusta antes da fórmula.

### Fórmula final
- `src/v2/ringClassifier.ts`.
- Arquivo deliberadamente não alterado nesta evolução.

## Feature flags

Arquivo: `src/v2/featureFlags.ts`

- ENABLE_PERSPECTIVE_CORRECTION = true
- ENABLE_MULTI_SAMPLE_WIDTH = true
- ENABLE_DEVICE_ORIENTATION = true
- ENABLE_HAND_LANDMARKS = false
- ENABLE_FINGER_SEGMENTATION = false
- ENABLE_CAMERA_CORRECTION = false
- ENABLE_DEPTH_VALIDATION = false
- ENABLE_DEPTH_FROM_MOTION = false

## Fase 1 implementada

### Perspectiva
- quadrilátero do cartão;
- avaliação de geometria;
- `perspectiveScore`;
- homografia para plano físico 85,60 x 53,98 mm;
- captura rejeitada quando a geometria do cartão ultrapassa o limite seguro.

### Sensores
Arquivo: `src/v2/useDeviceCaptureQuality.ts`

Coleta, quando suportado:
- pitch;
- roll;
- movimento;
- stabilityScore.

O sensor não corrige aro.
Movimento alto impede captura e pede estabilidade.

### Multiponto
Arquivo: `src/v2/measurementQuality.ts`

A largura nova usa:
- até 50 cortes;
- Q1/Q3;
- IQR;
- remoção de outliers;
- mediana;
- média aparada;
- edgeScore.

A medição antiga continua calculada em paralelo apenas para comparação no debug.

### Confiança antes da fórmula
Componentes:
- cardScore;
- perspectiveScore;
- stabilityScore, quando disponível;
- edgeScore.

Segmentação e depth ficam neutros enquanto os respectivos flags estiverem desligados.

Se finalConfidence < 70, a fórmula de aro não é chamada.

## Debug

Mostra:
- medida antiga;
- medida robusta;
- diferença old -> new;
- mediana e média aparada;
- outliers;
- inclinação do dedo;
- pitch/roll/movimento;
- stabilityScore;
- perspectiveScore;
- edgeScore;
- finalConfidence;
- repetibilidade entre capturas;
- quatro cantos do cartão;
- estado do depth.

## Próximas fases

### Fase 2
- landmarks da mão;
- identificação automática do dedo;
- jointRegion;
- ringRegion;
- segmentação do dedo.

### Fase 3
- perfil/correção de câmera;
- depth validation;
- ToF/LiDAR quando exposto pela plataforma.

### Fase 4
- depth from motion experimental, desligado por padrão.

A ativação de cada fase deve ocorrer somente após comparação old vs new e validação de repetibilidade.
