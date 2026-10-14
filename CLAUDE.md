# Medidor de Anel IA — regras do projeto

## Versão /v2 CONGELADA (14/10/2026)

A medição da v2 foi travada pelo Tiago na versão publicada em 14/10/2026
(cópia fixa no branch `v2-congelada-2026-10-14`, commit 8cb953d). Nos testes dele: 15/15 dentro
de ±1 aro.

**Proibido mexer na lógica de medição.** Não alterar, sem pedido explícito do Tiago:
- cálculo, detecção ou calibração: `src/v2/visionV2.ts`, `src/v2/cardCalibration.ts`,
  `src/v2/measurementPipeline.ts`, `src/v2/measurementQuality.ts`,
  `src/v2/ringClassifier.ts`, `src/v2/physicalRingTable.ts`,
  `src/v2/fingerContourAnatomy.ts`, `src/v2/handLandmarks.ts`, `src/perspective.ts`;
- em `src/v2/AppV2.tsx`: funções de captura, linhas do cartão/dedo, escala
  (interseções A-B = 85,60 mm), cortes/snaps, gate de qualidade, curva e
  classificação do aro, e os valores numéricos/constantes usados nelas;
- o que aparece só no modo privado (5 toques no losango) continua só lá.

**Permitido: só a parte visual** — cores, fontes, espaçamentos, ícones, textos de
instrução para o cliente, layout das telas (`src/styles.css` e JSX de
apresentação), desde que nenhum número calculado mude.

Qualquer mudança visual: fazer num link de teste (PR / deploy preview), conferir
que a medida das mesmas fotos não muda, e só publicar no `main` quando o Tiago pedir.
