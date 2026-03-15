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
