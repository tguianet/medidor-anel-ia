# Medidor de Anel IA — regras do projeto

## Versão /v2 MANUAL CONGELADA (16/10/2026)

A medição foi travada pelo Tiago na versão de **linhas manuais** de 16/10/2026
(cópia fixa no branch `v2-manual-congelada-2026-10-16`, commit ab81fec; link de
teste PR #53). Nos testes dele: 10/10 aros exatos (24, 25, 29, 30), desvio de
~0,08 mm entre fotos do mesmo dedo.

Como mede (não mudar):
- cartão: só as duas laterais; a linha vale exatamente onde o usuário solta (sem
  snap). Escala = distância A-B das interseções com a base = 85,60 mm;
- dedo: a largura vem só das duas linhas verdes (sem snap), multiplicada por
  cos(ângulo do dedo) — ângulo tirado do contorno da mesma foto;
- câmera do app com moldura do cartão; disparo automático só com DISTÂNCIA
  ADEQUADA; botão de TESTE tira foto nítida (ImageCapture) no mesmo enquadramento;
- resultado: só Exato e Conforto (sem Justo).

**Proibido mexer na lógica de medição.** Não alterar, sem pedido explícito do Tiago:
- cálculo, detecção ou calibração: `src/v2/visionV2.ts`, `src/v2/cardCalibration.ts`,
  `src/v2/measurementPipeline.ts`, `src/v2/measurementQuality.ts`,
  `src/v2/ringClassifier.ts`, `src/v2/physicalRingTable.ts`,
  `src/v2/fingerContourAnatomy.ts`, `src/v2/handLandmarks.ts`, `src/perspective.ts`,
  `src/v2/orientation.ts`;
- em `src/v2/AppV2.tsx`: funções de captura (inclusive a foto nítida), linhas do
  cartão/dedo, modo manual (`manualLines`, `fingerBandSamplesPx`, correção por
  cos do ângulo), escala (interseções A-B = 85,60 mm), gate de qualidade, curva e
  classificação do aro, e os valores numéricos/constantes usados nelas;
- em `src/v2/FrozenCameraScreen.tsx`: regras do disparo automático (distância,
  inclinação, centralização);
- o que aparece só no modo privado (5 toques no losango) continua só lá.

**Permitido: só a parte visual** — cores, fontes, espaçamentos, ícones, textos de
instrução para o cliente, layout das telas (`src/styles.css` e JSX de
apresentação), desde que nenhum número calculado mude.

Qualquer mudança visual: fazer num link de teste (PR / deploy preview), conferir
que a medida das mesmas fotos não muda, e só publicar no `main` quando o Tiago pedir.

Versão anterior (automática, 14/10/2026) continua guardada no branch
`v2-congelada-2026-10-14` (commit 8cb953d).
