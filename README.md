# ScootTok

Aplicacao web de videos estilo rede social.

## Rodar Localmente

```bash
npm install
npm start
```

Abre no browser: `http://localhost:3000`

## Deploy No Render (Sem Perder Dados)

1. Cria a Web Service no Render a partir do teu repo GitHub.
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Adiciona um Persistent Disk no Render (ex.: mount path `/var/data`).
5. Define estas variaveis de ambiente no Render:

```txt
DATA_DIR=/var/data
DATABASE_PATH=/var/data/scoottok.db
UPLOADS_DIR=/var/data/uploads
```

Sem disco persistente, a base de dados e uploads podem desaparecer apos restart/deploy.

O servidor SQLite agora tambem atualiza o ficheiro `database.json` a cada alteracao importante.
Isto evita voltar a um snapshot antigo em muitos restarts locais, mas em hosting sem disco persistente continuas a precisar de um volume persistente para nao perder dados.

## Compliance E Seguranca (Alta)

O projeto agora inclui:

1. Analise automatica de risco de plágio e direitos no upload.
2. Declaracao obrigatoria de direitos do utilizador.
3. Prova de licenca para musica/imagem quando necessario.
4. Fila de moderacao antes de publicar no feed.
5. Banimento automatico em violacoes graves.
6. Trilho de auditoria e endpoints de takedown.
7. Endpoint de purge total de videos para emergencia.

### Variaveis de Ambiente Recomendadas

```txt
MODERATOR_USERS=admin,teu_utilizador_moderador
```

Se `MODERATOR_USERS` nao estiver configurado, uploads ficam desativados por seguranca.

### Preciso de API paga (ChatGPT/OpenAI)?

Nao, para o sistema atual nao precisas de API paga.

As verificacoes atuais sao locais (servidor) e nao dependem de chave externa.
Se quiseres, no futuro pode-se integrar provedores externos, mas nao e obrigatorio.

### Documentos Legais Base

1. `docs/legal/TERMS.md`
2. `docs/legal/COPYRIGHT_POLICY.md`
3. `docs/legal/TAKEDOWN_POLICY.md`

## Upload Para GitHub Com Ficheiros > 25MB

O limite de 25MB e do upload no site do GitHub. Para videos grandes, usa Git LFS no terminal:

```bash
git lfs install
git add .gitattributes .gitignore
git add uploads
git add .
git commit -m "Configurar Git LFS para uploads"
git push
```
