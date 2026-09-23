# Medidor de Anel 2.0

Versao limpa criada para eliminar correcoes historicas acumuladas no sistema anterior.

## Principios

1. A calibracao pelo cartao permanece independente e deve ser reaproveitada somente depois de validada isoladamente.
2. A visao computacional mede apenas o dedo em pixels e converte para milimetros.
3. A conversao de milimetros para aro acontece em um modulo separado.
4. Nenhuma regra antiga de +1, -2, MAB, curva hibrida, zona local ou correcao aprendida entra automaticamente nesta versao.
5. A tabela fisica dos aneis e a fonte da verdade e preserva os dois eixos medidos no paquimetro, inclusive ovalizacao.

## Pipeline

foto -> calibracao do cartao -> bordas do dedo -> largura em px -> mm -> classificador de aro

A etapa de visao nao sabe qual aro esta sendo medido.

## Fonte fisica

Arquivo: `src/v2/physicalRingTable.ts`

Cada aro armazena:
- eixo A;
- eixo B;
- menor diametro;
- maior diametro;
- media dos dois eixos;
- crescimento em mm em relacao ao aro anterior.

## Regra de desenvolvimento

Toda nova regra deve responder a uma destas perguntas:

- melhora a medicao fisica em mm?
- melhora a classificacao mm -> aro?

Se nao responder claramente a uma delas, nao entra na V2.

## Estado inicial

Branch: `medidor-anel-2-0`

A branch `main` continua sendo o sistema atual e nao deve ser alterada pelos testes da V2.
