# App Android do Medidor de Anel (Capacitor)

O app nativo usa **o mesmo código do site** (pasta `dist`), empacotado com o
Capacitor. A medição é a mesma da versão congelada.

- Nome: **Medidor de Anel**
- Identificador (não pode mudar depois de publicar): `br.com.tguianet.medidoranel`

## 1. Instalar no PC (uma vez só, Windows)

1. **Node.js LTS** – https://nodejs.org (marque "Add to PATH").
2. **Git** – https://git-scm.com/download/win
3. **Android Studio** – https://developer.android.com/studio
   Na primeira abertura, deixe instalar o *Android SDK* (padrão).

## 2. Baixar o projeto e gerar o app

No **Prompt de Comando** (ou PowerShell):

```bat
git clone https://github.com/tguianet/medidor-anel-ia.git
cd medidor-anel-ia
git checkout app-android
npm install
npm run android:setup
npm run android:open
```

`android:setup` faz tudo: gera o site, cria o projeto Android, adiciona a
permissão de câmera, gera ícone e tela de abertura e sincroniza.
`android:open` abre o projeto no Android Studio.

## 3. Testar no seu celular (sem conta Google Play)

1. No celular: Configurações → Sobre o telefone → toque 7 vezes em
   **Número da versão** (ativa o modo desenvolvedor).
2. Configurações → Sistema → Opções do desenvolvedor → ligue **Depuração USB**.
3. Ligue o celular no PC pelo cabo e aceite "Permitir depuração".
4. No Android Studio, escolha o celular no topo e clique em ▶ **Run**.

O app instala no celular com o ícone dourado. Na primeira medição ele pede
permissão da câmera: toque em **Permitir**.

Para mandar o app para outra pessoa testar (sem loja):
Android Studio → **Build → Build App Bundle(s) / APK(s) → Build APK(s)** e
envie o arquivo `app-debug.apk` (fica em `android/app/build/outputs/apk/debug/`).

## 4. Depois de mexer no site

Sempre que o código do site mudar:

```bat
git pull
npm run android:sync
```

e rode de novo pelo Android Studio.

## 5. Publicar na Play Store (quando tiver a conta)

1. Criar a conta em https://play.google.com/console (taxa única de US$ 25).
2. Android Studio → **Build → Generate Signed App Bundle / APK** → *Android App Bundle*.
   Crie a chave de assinatura (arquivo `.jks`) e **guarde muito bem a chave e a
   senha**: sem ela não dá para atualizar o app depois. Ela nunca vai para o GitHub.
3. No Play Console: criar o app → enviar o `.aab` → preencher ficha da loja,
   política de privacidade e classificação.
4. Contas pessoais novas normalmente precisam de um **teste fechado com cerca de
   12 testadores por 14 dias** antes de liberar ao público (confirme no console).
