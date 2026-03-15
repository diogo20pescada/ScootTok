# ScootTok
<<<<<<< HEAD
Uma simples rede social sobre trotinetes
=======

Aplicação web de vídeos estilo rede social.

## Rodar localmente

```bash
npm install
npm start
```

Abre no browser:

- `http://localhost:3000`

---

## Publicar para acesso mundial (URL pública)

### Opção simples: Render

1. Cria conta em Render.
2. Faz upload deste projeto para um repositório GitHub.
3. No Render: **New +** -> **Web Service**.
4. Liga o repositório do ScootTok.
5. Configura:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
6. Faz deploy.
7. O Render gera um URL público (`https://...onrender.com`).
8. Envia esse URL para qualquer pessoa.

---

## Nota importante sobre dados

Atualmente os dados ficam em `database.json` e os vídeos em `uploads/`.
Em vários hostings cloud, o disco pode ser temporário. Para produção real (dados permanentes), o ideal é migrar para:

- Base de dados externa (ex.: PostgreSQL/Supabase)
- Armazenamento de ficheiros externo (ex.: Cloudinary/S3)

Se quiseres, posso já fazer essa migração no próximo passo.

---

## Upload para GitHub com ficheiros > 25MB

O limite de 25MB é do upload no site do GitHub. Para vídeos grandes, usa Git LFS no terminal:

```bash
git lfs install
git add .gitattributes .gitignore
git add uploads
git add .
git commit -m "Configurar Git LFS para uploads"
git push
```

Se algum ficheiro grande já foi commitado sem LFS, corre antes:

```bash
git lfs migrate import --include="uploads/**,*.mp4,*.mov,*.mkv,*.webm"
git push --force-with-lease
```
>>>>>>> 97825e8 (Primeiro commit)
