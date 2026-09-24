# Medidor de Anel IA — Referência técnica e histórico útil

> Documento-mãe do projeto.  
> Atualizado em 23/09/2026.  
> Objetivo: preservar o caminho técnico que levou ao estado atual, os dados físicos confiáveis e as regras que não devem ser confundidas entre si.

## 1. Estado atual do projeto

Repositório: `tguianet/medidor-anel-ia`  
Aplicação principal: `https://medidor-anel-ia.netlify.app/`

O sistema mede o dedo usando um cartão bancário como referência física de escala.

Fluxo atual do modo dedo:

1. Foto 1: cartão usado como referência de 85,60 mm.
2. Foto 2: cartão colocado sobre o dedo.
3. As laterais do cartão são encontradas por snaps magnéticos.
4. O snap matemático fica separado da linha visual: depois de travado na borda real, mover a guia visual não deve alterar o tamanho usado no cálculo.
5. A reta física de 85,60 mm é construída entre os snaps.
6. A diferença de perspectiva/escala entre Foto 1 e Foto 2 é registrada como diagnóstico, mas não bloqueia mais a medição.
7. A escala física da Foto 2 é usada para converter pixels em milímetros.
8. O dedo é medido por múltiplas leituras magnéticas próximas da região escolhida.
9. A inclinação do dedo é compensada medindo a largura perpendicular ao eixo do dedo.
10. O resultado técnico é convertido para número de aro e o sistema apresenta também o conforto (+1).

Constante de normalização ainda presente no modo dedo:

```ts
const TEST_FINGER_CARD_NORMALIZATION = 0.908;
```

Esse fator é importante: em teste real recente, uma leitura bruta de 21,84 mm virou 19,83 mm e o resultado foi aro 24 / conforto 25, confirmado fisicamente.

## 2. Princípios que não devem ser misturados

Existem três grandezas diferentes no projeto:

### A. Largura física do dedo
É a medida obtida pela câmera após a conversão pixel -> mm.

### B. Diâmetro interno do anel físico
É medido diretamente no paquímetro. Alguns anéis estão ovalizados e por isso foram medidos em dois eixos.

### C. Dados de anelímetro / bancada
São úteis para validação e testes, mas não devem substituir automaticamente os dados do dedo nem os dados físicos dos anéis.

Regra: nunca comparar diretamente largura externa do dedo com diâmetro interno do anel como se fossem a mesma grandeza.

## 3. Tabela física oficial — duas medições no paquímetro

Esta é a tabela física mais recente passada novamente em 23/09/2026.  
Cada anel foi medido duas vezes / em dois eixos para revelar ovalização.

| Aro | Medição 1 (mm) | Medição 2 (mm) | Dif. entre eixos | Média (mm) | Dif. média p/ próximo |
|---:|---:|---:|---:|---:|---:|
| 11 | 15,4 | 15,4 | 0,0 | 15,40 | +0,40 |
| 12 | 15,9 | 15,7 | 0,2 | 15,80 | +0,35 |
| 13 | 16,2 | 16,1 | 0,1 | 16,15 | +0,30 |
| 14 | 16,5 | 16,4 | 0,1 | 16,45 | +0,30 |
| 15 | 16,7 | 16,8 | 0,1 | 16,75 | +0,40 |
| 16 | 17,2 | 17,1 | 0,1 | 17,15 | +0,30 |
| 17 | 17,5 | 17,4 | 0,1 | 17,45 | +0,30 |
| 18 | 17,7 | 17,8 | 0,1 | 17,75 | +0,45 |
| 19 | 18,2 | 18,2 | 0,0 | 18,20 | +0,25 |
| 20 | 18,4 | 18,5 | 0,1 | 18,45 | +0,35 |
| 21 | 18,7 | 18,9 | 0,2 | 18,80 | +0,50 |
| 22 | 19,2 | 19,4 | 0,2 | 19,30 | +0,25 |
| 23 | 19,4 | 19,7 | 0,3 | 19,55 | +0,25 |
| 24 | 19,9 | 19,7 | 0,2 | 19,80 | +0,40 |
| 25 | 20,3 | 20,1 | 0,2 | 20,20 | +0,45 |
| 26 | 20,6 | 20,7 | 0,1 | 20,65 | +0,20 |
| 27 | 20,8 | 20,9 | 0,1 | 20,85 | +0,40 |
| 28 | 21,3 | 21,2 | 0,1 | 21,25 | +0,30 |
| 29 | 21,4 | 21,7 | 0,3 | 21,55 | +0,45 |
| 30 | 22,0 | 22,0 | 0,0 | 22,00 | +0,25 |
| 31 | 22,0 | 22,5 | 0,5 | 22,25 | +0,30 |
| 32 | 22,5 | 22,6 | 0,1 | 22,55 | +0,40 |
| 33 | 23,2 | 22,7 | 0,5 | 22,95 | — |

### Leitura correta desta tabela

A progressão geral é fortemente concentrada em aproximadamente 0,30 a 0,40 mm por aro.

Trecho particularmente coerente:

- 13 -> 14 = +0,30
- 14 -> 15 = +0,30
- 15 -> 16 = +0,40
- 16 -> 17 = +0,30
- 17 -> 18 = +0,30

Isso reproduz o padrão observado empiricamente de aproximadamente:

`0,3 / 0,3 / 0,4 / 0,3 / 0,3 / 0,4 ...`

Os desvios maiores devem ser tratados com cautela porque há ovalização real. Exemplos fortes:

- aro 31: 22,0 x 22,5 -> diferença 0,5 mm
- aro 33: 23,2 x 22,7 -> diferença 0,5 mm
- aro 29: 21,4 x 21,7 -> diferença 0,3 mm

Portanto, a média é útil para tendência, mas os dois eixos originais devem ser preservados.

## 4. Regra de coerência física

A diferença esperada entre aros consecutivos costuma ficar perto de 0,3–0,4 mm.

Essa regra deve funcionar como teste de sanidade, não como substituição das medições.

Se aparecer um salto muito fora da faixa, verificar antes de alterar fórmula:

- ovalização do anel;
- eixo do paquímetro;
- identificação do aro;
- erro de leitura;
- diferença entre lote/fornecedor.

Não corrigir automaticamente a câmera ou a curva só porque um único anel foge do padrão.

## 5. Curva híbrida atual do modo dedo

O código atual contém uma curva híbrida específica para largura do dedo. Ela não é a tabela física do anel.

Centros atuais:

| Aro | Largura de referência do dedo (mm) | Status |
|---:|---:|---|
| 10 | 14,64 | confirmado |
| 11 | 14,97 | interpolado |
| 12 | 15,29 | interpolado |
| 13 | 15,62 | interpolado |
| 14 | 15,95 | interpolado |
| 15 | 16,28 | interpolado |
| 16 | 16,60 | interpolado |
| 17 | 16,93 | confirmado |
| 18 | 17,29 | interpolado |
| 19 | 17,65 | interpolado |
| 20 | 18,01 | interpolado |
| 21 | 18,37 | confirmado |
| 22 | 18,65 | confirmado |
| 23 | 19,27 | interpolado |
| 24 | 19,89 | confirmado |
| 25 | 20,34 | confirmado |
| 26 | 20,54 | interpolado |
| 27 | 20,75 | interpolado |
| 28 | 20,95 | interpolado |
| 29 | 21,15 | confirmado |
| 30 | 21,30 | confirmado |
| 31 | 21,52 | provisório |
| 32 | 21,69 | provisório |
| 33 | 21,92 | provisório |

Importante: essa tabela pertence ao cálculo do dedo e não deve ser substituída pela tabela física do paquímetro sem uma nova validação controlada.

## 6. Ajustes que levaram ao estado atual

### 6.1 Cartão como escala física
O cartão passou a ser tratado pela largura conhecida de 85,60 mm.

### 6.2 Duas fotos
Foi adotado o fluxo com uma foto de referência e uma foto de medição sobre o dedo.

### 6.3 Snaps laterais
Os snaps foram endurecidos para evitar pular para sombra, textura ou borda errada.

Ajustes relevantes:
- raio de busca menor;
- penalidade maior para bordas distantes;
- confiança mínima maior;
- validação de largura plausível.

### 6.4 Snap matemático separado da guia visual
Depois que a lateral encontra a borda real, a geometria usada no cálculo fica travada. A guia pode ser ajustada visualmente sem esticar a medida matemática.

### 6.5 Linha de 85,60 mm automática
A reta de referência passou a ser construída entre as laterais travadas, evitando depender de ajuste manual do seu comprimento.

### 6.6 Compensação angular entre as fotos
A geometria foi ajustada para tolerar pequenas diferenças de ângulo/perspectiva entre Foto 1 e Foto 2.

Hoje a diferença entre as duas fotos pode ser mostrada como diagnóstico, mas não bloqueia a medição.

### 6.7 Quatro leituras do dedo
A região do dedo passou a usar múltiplas amostras magnéticas, permitindo rejeitar extremos e reduzir influência de uma borda ruim.

### 6.8 Compensação da inclinação do dedo
A largura passou a ser medida perpendicularmente ao eixo do dedo, reduzindo erro quando o dedo não está perfeitamente reto na imagem.

### 6.9 Normalização 0,908
Foi mantida como parte do modo dedo porque, em teste real confirmado:

- medida bruta: 21,84 mm
- após 0,908: 19,83 mm
- resultado: aro exato 24
- conforto: 25
- aro físico confirmado pelo usuário

Não remover esse fator sem nova bateria de testes.

## 7. Marco estável recuperável

Ponto histórico importante antes da simplificação comercial:

Commit:

`a547f7aa8fa7de3c89f0ef9f00286bb3fa5eb955`

Mensagem:

`Amplia faixa real do aro 29 para 20.95 mm`

Esse commit preserva um estado em que já existiam:

- duas fotos;
- snaps laterais travados;
- linha automática do cartão;
- compensação de inclinação do dedo;
- normalização 0,908;
- curva híbrida do dedo;
- interface ainda com ferramentas de teste visíveis.

Depois desse ponto vieram alterações de interface comercial e diagnóstico privado.

## 8. Estado atual de diagnóstico

O projeto atual possui modo privado de diagnóstico ativado dentro da própria página, sem abrir uma rota separada, para não interferir com a câmera.

Entre os dados úteis exibidos em testes recentes:

- largura final;
- quatro larguras em pixels;
- largura usada;
- variação entre amostras;
- inclinação compensada;
- escala mm/px;
- medida bruta;
- comprimento do cartão na Foto 1;
- comprimento do cartão na Foto 2;
- diferença percentual entre as fotos.

Exemplo real validado:

- medida bruta: 21,84 mm
- medida final: 19,83 mm
- larguras: 175,0 / 176,3 / 177,0 / 177,6 px
- largura usada: 176,66 px
- variação: 1,49%
- inclinação compensada: 4,4°
- escala: 0,1236 mm/px
- cartão Foto 1: 708,3 px
- cartão Foto 2: 692,4 px
- diferença: -2,25%
- resultado correto: aro 24 / conforto 25

## 9. Regras para próximos ajustes

1. Não mexer em várias camadas ao mesmo tempo.
2. Primeiro verificar geometria do cartão.
3. Depois verificar snaps.
4. Depois verificar largura do dedo em pixels.
5. Depois verificar conversão px -> mm.
6. Só então avaliar a curva de classificação de aro.
7. Não usar um anel oval isolado para recalibrar toda a curva.
8. Preservar sempre a medida bruta antes de aplicar normalização.
9. Registrar o aro real usado no teste.
10. Ao alterar a fórmula, testar novamente aros baixos, médios e altos.
11. Nunca misturar tabela do paquímetro, tabela do anelímetro e curva de largura do dedo.
12. Antes de qualquer alteração grande, registrar um commit/branch de segurança.

## 10. Dados obsoletos que não devem voltar por engano

Durante o desenvolvimento foram testadas várias correções globais e fórmulas temporárias. Elas não devem ser reintroduzidas apenas porque aparecem em commits antigos.

Exemplos:
- somar/subtrair número fixo de aros globalmente;
- correção percentual baseada apenas na confiança do cartão;
- aplicar diretamente a tabela do anelímetro ao dedo;
- tratar largura do dedo como se fosse diâmetro interno do anel;
- bloquear o usuário apenas pela diferença percentual entre Foto 1 e Foto 2.

Essas abordagens serviram como experimentos e foram substituídas por uma geometria mais estável.

## 11. Fonte de verdade daqui para frente

Para recuperar o projeto sem depender do histórico do chat:

- estado atual do código: branch `main`;
- marco histórico estável: commit `a547f7aa8fa7de3c89f0ef9f00286bb3fa5eb955`;
- tabela física oficial mais recente: Seção 3 deste documento;
- curva de dedo vigente: conferir `src/ringCalculation.ts`;
- fluxo/calibração/snaps: conferir `src/App.tsx`.

Quando uma conversa nova começar, este arquivo deve ser lido antes de alterar matemática, tabela ou calibração.


## 12. Teste validado — aro 33 (24/09/2026)

Teste confirmado pelo usuário como dedo real de aro exato 33.

Dados do diagnóstico privado:

- resultado: justo 32 / exato 33 / conforto 34;
- medida final: 25,26 mm;
- modo: híbrido, linhas manuais + 50 refinamentos automáticos;
- cortes válidos: 47;
- região mais larga estável: pontos 6–12;
- platô usado: 197,3 / 197,4 / 197,4 / 197,4 / 197,5 / 197,2 / 197,3 px;
- largura usada: 197,35 px;
- variação: 4,53 px = 2,29%;
- escala: 0,1280 mm/px;
- medida bruta Foto 2: 25,26 mm;
- correção extra entre fotos: desativada;
- medida usada pela V2: 25,26 mm;
- cartão Foto 1: 693,2 px;
- cartão Foto 2: 668,8 px;
- diferença Foto 1 -> Foto 2: -3,52%;
- a diferença entre fotos ficou apenas como diagnóstico.

Interpretação:
- o sistema acertou o aro 33 mesmo com diferença geométrica de 3,52% entre as duas fotos;
- o conjunto de cortes formou um platô visualmente estável;
- este teste é uma referência positiva de repetibilidade da geometria atual;
- ele NÃO deve ser usado sozinho para reposicionar o centro do aro 33, porque a classificação atual considera todo valor a partir de 22,35 mm como aro 33. Ou seja, 25,26 mm confirma a classificação superior, mas não define com precisão a fronteira 32/33.

### Situação da curva após este teste

A curva operacional atual continua ancorada principalmente na régua física derivada do aro 29 e nas diferenças medidas no paquímetro.

Fronteiras vigentes no trecho alto:
- aro 28: 20,65–21,00 mm
- aro 29: 21,00–21,375 mm
- aro 30: 21,375–21,725 mm
- aro 31: 21,725–22,00 mm
- aro 32: 22,00–22,35 mm
- aro 33: >= 22,35 mm

O teste de 25,26 mm confirma que o sistema permanece coerente no extremo superior, mas a estabilidade fina da curva deve continuar sendo validada com medições próximas das fronteiras entre aros consecutivos, principalmente 31/32 e 32/33.
