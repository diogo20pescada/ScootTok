const express = require("express")
const multer = require("multer")
const fs = require("fs")
const cors = require("cors")
const path = require("path")
const Database = require("better-sqlite3")

const app = express()
const PORT = Number(process.env.PORT) || 3000
const ROOT_DIR = __dirname
const PUBLIC_DIR = path.join(ROOT_DIR, "public")
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT_DIR
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(DATA_DIR, "uploads")
const LEGACY_DB_JSON_PATH = path.join(ROOT_DIR, "database.json")
const SQLITE_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(DATA_DIR, "scoottok.db")

if (!fs.existsSync(path.dirname(SQLITE_PATH))) {
  fs.mkdirSync(path.dirname(SQLITE_PATH), { recursive: true })
}

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}

const db = new Database(SQLITE_PATH)

db.pragma("journal_mode = WAL")
db.pragma("foreign_keys = ON")

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY,
    user_username TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL,
    mimetype TEXT NOT NULL DEFAULT '',
    thumbnail TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_username) REFERENCES users(username) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS follows (
    follower TEXT NOT NULL,
    following TEXT NOT NULL,
    PRIMARY KEY (follower, following),
    FOREIGN KEY(follower) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY(following) REFERENCES users(username) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS video_likes (
    video_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    PRIMARY KEY (video_id, username),
    FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE,
    FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS video_views (
    video_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    viewed_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (video_id, username),
    FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE,
    FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY,
    video_id INTEGER NOT NULL,
    user_display TEXT NOT NULL,
    text TEXT NOT NULL,
    author_username TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_videos_user ON videos(user_username);
  CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at);
  CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower);
  CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following);
  CREATE INDEX IF NOT EXISTS idx_video_views_viewed_at ON video_views(viewed_at);
  CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id);
`)

try {
  db.exec(`ALTER TABLE videos ADD COLUMN thumbnail TEXT NOT NULL DEFAULT ''`)
} catch (_) {}

try {
  db.exec(`ALTER TABLE video_views ADD COLUMN viewed_at INTEGER NOT NULL DEFAULT 0`)
} catch (_) {}

function getRowValue(row, key, fallback = 0) {
  if (!row) {
    return fallback
  }

  const value = row[key]
  return typeof value === "number" ? value : fallback
}

function migrateFromLegacyJsonIfNeeded() {
  const usersCount = getRowValue(db.prepare("SELECT COUNT(*) AS count FROM users").get(), "count")

  if (usersCount > 0) {
    return
  }

  if (!fs.existsSync(LEGACY_DB_JSON_PATH)) {
    return
  }

  const raw = fs.readFileSync(LEGACY_DB_JSON_PATH, "utf8")
  const legacy = JSON.parse(raw)

  const users = Array.isArray(legacy.users) ? legacy.users : []
  const videos = Array.isArray(legacy.videos) ? legacy.videos : []
  const follows = Array.isArray(legacy.follows) ? legacy.follows : []

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password, display_name, avatar)
    VALUES (@id, @username, @password, @display_name, @avatar)
  `)

  const insertVideo = db.prepare(`
    INSERT OR IGNORE INTO videos (id, user_username, title, description, file_name, mimetype, created_at)
    VALUES (@id, @user_username, @title, @description, @file_name, @mimetype, @created_at)
  `)

  const insertFollow = db.prepare(`
    INSERT OR IGNORE INTO follows (follower, following)
    VALUES (@follower, @following)
  `)

  const insertLike = db.prepare(`
    INSERT OR IGNORE INTO video_likes (video_id, username)
    VALUES (@video_id, @username)
  `)

  const insertView = db.prepare(`
    INSERT OR IGNORE INTO video_views (video_id, username, viewed_at)
    VALUES (@video_id, @username, @viewed_at)
  `)

  const insertComment = db.prepare(`
    INSERT OR IGNORE INTO comments (id, video_id, user_display, text, author_username, created_at)
    VALUES (@id, @video_id, @user_display, @text, @author_username, @created_at)
  `)

  const transaction = db.transaction(() => {
    users.forEach(user => {
      const username = String(user?.username || "").trim()
      const password = String(user?.password || "")

      if (!username || !password) {
        return
      }

      insertUser.run({
        id: Number(user.id) || Date.now(),
        username,
        password,
        display_name: String(user.displayName || username),
        avatar: String(user.avatar || "")
      })
    })

    videos.forEach(video => {
      const userUsername = String(video?.user || "").trim()
      if (!userUsername) {
        return
      }

      if (!getUserByUsername(userUsername)) {
        return
      }

      const videoId = Number(video.id) || Date.now()
      insertVideo.run({
        id: videoId,
        user_username: userUsername,
        title: String(video.title || "Sem título"),
        description: String(video.desc || ""),
        file_name: String(video.file || ""),
        mimetype: String(video.mimetype || ""),
        created_at: videoId
      })

      const likedBy = Array.isArray(video.likedBy) ? video.likedBy : []
      likedBy.forEach(username => {
        const cleanUsername = String(username || "").trim()
        if (!cleanUsername || !getUserByUsername(cleanUsername)) {
          return
        }

        insertLike.run({ video_id: videoId, username: cleanUsername })
      })

      const viewedBy = Array.isArray(video.viewedBy) ? video.viewedBy : []
      viewedBy.forEach(username => {
        const cleanUsername = String(username || "").trim()
        if (!cleanUsername || !getUserByUsername(cleanUsername)) {
          return
        }

        insertView.run({ video_id: videoId, username: cleanUsername, viewed_at: videoId })
      })

      const comments = Array.isArray(video.comments) ? video.comments : []
      comments.forEach((comment, index) => {
        const commentData = typeof comment === "string"
          ? { id: videoId * 1000 + index, user: "Anónimo", text: comment, author: "" }
          : comment

        insertComment.run({
          id: Number(commentData.id) || Date.now() + index,
          video_id: videoId,
          user_display: String(commentData.user || "Anónimo"),
          text: String(commentData.text || ""),
          author_username: String(commentData.author || ""),
          created_at: Number(commentData.id) || Date.now() + index
        })
      })
    })

    follows.forEach(follow => {
      const follower = String(follow?.follower || "").trim()
      const following = String(follow?.following || "").trim()

      if (!follower || !following || follower === following) {
        return
      }

      if (!getUserByUsername(follower) || !getUserByUsername(following)) {
        return
      }

      insertFollow.run({ follower, following })
    })
  })

  transaction()
}

function getSafeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatar: user.avatar || ""
  }
}

function getUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username)
}

function isFollowing(follower, following) {
  const row = db
    .prepare("SELECT 1 AS exists_value FROM follows WHERE follower = ? AND following = ? LIMIT 1")
    .get(follower, following)

  return Boolean(row)
}

function getCommentsByVideoId(videoId) {
  return db
    .prepare("SELECT id, user_display, text, author_username FROM comments WHERE video_id = ? ORDER BY id ASC")
    .all(videoId)
    .map(comment => ({
      id: comment.id,
      user: comment.user_display || "Anónimo",
      text: comment.text || "",
      author: comment.author_username || ""
    }))
}

function decorateVideo(video, viewer) {
  const owner = getUserByUsername(video.user_username)

  const likesRow = db.prepare("SELECT COUNT(*) AS count FROM video_likes WHERE video_id = ?").get(video.id)
  const viewsRow = db.prepare("SELECT COUNT(*) AS count FROM video_views WHERE video_id = ?").get(video.id)

  const liked = viewer
    ? Boolean(db.prepare("SELECT 1 FROM video_likes WHERE video_id = ? AND username = ? LIMIT 1").get(video.id, viewer))
    : false

  const viewed = viewer
    ? Boolean(db.prepare("SELECT 1 FROM video_views WHERE video_id = ? AND username = ? LIMIT 1").get(video.id, viewer))
    : false

  const followed = viewer ? isFollowing(viewer, video.user_username) : false

  return {
    id: video.id,
    createdAt: video.created_at || video.id,
    user: video.user_username,
    title: video.title,
    desc: video.description,
    file: video.file_name,
    mimetype: video.mimetype || "",
    thumbnail: video.thumbnail || "",
    likes: getRowValue(likesRow, "count"),
    views: getRowValue(viewsRow, "count"),
    likedBy: [],
    viewedBy: [],
    comments: getCommentsByVideoId(video.id),
    owner: owner
      ? getSafeUser(owner)
      : {
        username: video.user_username,
        displayName: video.user_username,
        avatar: ""
      },
    liked,
    viewed,
    followed
  }
}

function textIncludes(value, searchTerm) {
  return String(value || "").toLowerCase().includes(searchTerm)
}

function filterVideosBySearch(videos, searchTerm) {
  if (!searchTerm) {
    return videos
  }

  return videos.filter(video => (
    textIncludes(video.title, searchTerm)
    || textIncludes(video.description, searchTerm)
    || textIncludes(video.user_username, searchTerm)
  ))
}

function sortByViewsThenRecent(a, b) {
  const viewsDiff = (b.views || 0) - (a.views || 0)
  if (viewsDiff !== 0) {
    return viewsDiff
  }

  return (b.createdAt || b.id || 0) - (a.createdAt || a.id || 0)
}

function pickVideosByProgressiveWindow(videos) {
  const now = Date.now()

  if (!videos.length) {
    return videos
  }

  for (let hours = 5; hours <= 240; hours += 5) {
    const cutoff = now - (hours * 60 * 60 * 1000)
    const candidates = videos
      .filter(video => (video.createdAt || video.id || 0) >= cutoff)
      .sort(sortByViewsThenRecent)

    if (candidates.length) {
      return candidates
    }
  }

  return videos.sort(sortByViewsThenRecent)
}

migrateFromLegacyJsonIfNeeded()

app.use(express.json({ limit: "10mb" }))
app.use(cors())
app.use(express.static(PUBLIC_DIR))
app.use("/uploads", express.static(UPLOADS_DIR))

const uploadStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, callback) => {
    const originalExt = path.extname(file.originalname || "")
    const fallbackExt = file.fieldname === "thumbnail" ? ".jpg" : ".mp4"
    const safeExt = originalExt ? originalExt.toLowerCase() : fallbackExt
    callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`)
  }
})

const upload = multer({
  storage: uploadStorage,
  limits: {
    fileSize: 1024 * 1024 * 500
  },
  fileFilter: (req, file, callback) => {
    const mime = String(file.mimetype || "")
    if (file.fieldname === "video" && !mime.startsWith("video/")) {
      return callback(new Error("Só ficheiros de vídeo são permitidos"))
    }
    if (file.fieldname === "thumbnail" && !mime.startsWith("image/")) {
      return callback(new Error("A capa deve ser uma imagem"))
    }
    callback(null, true)
  }
})

const uploadHandler = upload.fields([
  { name: "video", maxCount: 1 },
  { name: "thumbnail", maxCount: 1 }
])

app.post("/register", (req, res) => {
  const username = String(req.body.username || "").trim()
  const password = String(req.body.password || "").trim()

  if (!username || !password) {
    return res.status(400).json({ error: "Preenche username e password" })
  }

  if (getUserByUsername(username)) {
    return res.status(409).json({ error: "Esse username já existe" })
  }

  const id = Date.now()
  db.prepare(`
    INSERT INTO users (id, username, password, display_name, avatar)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, username, password, username, "")

  const user = getUserByUsername(username)
  return res.json(getSafeUser(user))
})

app.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim()
  const password = String(req.body.password || "").trim()

  const user = db.prepare("SELECT * FROM users WHERE username = ? AND password = ?").get(username, password)

  if (!user) {
    return res.status(401).json({ error: "Erro login" })
  }

  return res.json(getSafeUser(user))
})

app.post("/upload", uploadHandler, (req, res) => {
  const user = String(req.body.user || "").trim()
  const title = String(req.body.title || "").trim()
  const desc = String(req.body.desc || "").trim()
  const videoFile = req.files?.video?.[0]
  const thumbnailFile = req.files?.thumbnail?.[0]

  if (!videoFile) {
    return res.status(400).json({ error: "Escolhe um vídeo" })
  }

  if (!title) {
    return res.status(400).json({ error: "Título obrigatório" })
  }

  if (!getUserByUsername(user)) {
    return res.status(404).json({ error: "Utilizador não encontrado" })
  }

  const id = Date.now()
  db.prepare(`
    INSERT INTO videos (id, user_username, title, description, file_name, mimetype, thumbnail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, user, title, desc, videoFile.filename, String(videoFile.mimetype || ""), thumbnailFile ? thumbnailFile.filename : "", id)

  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(id)
  return res.json(decorateVideo(video, user))
})

app.get("/media/:id", (req, res) => {
  const id = Number(req.params.id)
  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(id)

  if (!video) {
    return res.status(404).json({ error: "Vídeo não encontrado" })
  }

  const uploadsRoot = path.resolve(UPLOADS_DIR)
  const mediaPath = path.resolve(uploadsRoot, String(video.file_name || ""))

  if (!mediaPath.startsWith(uploadsRoot + path.sep)) {
    return res.status(400).json({ error: "Caminho de vídeo inválido" })
  }

  if (!fs.existsSync(mediaPath)) {
    return res.status(404).json({ error: "Ficheiro de vídeo não encontrado" })
  }

  if (video.mimetype) {
    res.type(video.mimetype)
  } else {
    res.type("video/mp4")
  }

  return res.sendFile(mediaPath)
})

app.get("/thumbnail/:id", (req, res) => {
  const id = Number(req.params.id)
  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(id)

  if (!video || !video.thumbnail) {
    return res.status(404).json({ error: "Thumbnail não disponível" })
  }

  const uploadsRoot = path.resolve(UPLOADS_DIR)
  const thumbPath = path.resolve(uploadsRoot, String(video.thumbnail || ""))

  if (!thumbPath.startsWith(uploadsRoot + path.sep)) {
    return res.status(400).json({ error: "Caminho inválido" })
  }

  if (!fs.existsSync(thumbPath)) {
    return res.status(404).json({ error: "Thumbnail não encontrado" })
  }

  return res.sendFile(thumbPath)
})

app.get("/videos", (req, res) => {
  const viewer = req.query.viewer ? String(req.query.viewer) : ""
  const searchTerm = String(req.query.q || "").trim().toLowerCase()
  const allVideos = db.prepare("SELECT * FROM videos ORDER BY created_at DESC").all()
  const filtered = filterVideosBySearch(allVideos, searchTerm)
  const decorated = filtered.map(video => decorateVideo(video, viewer))
  const ranked = searchTerm
    ? decorated.sort(sortByViewsThenRecent)
    : pickVideosByProgressiveWindow(decorated)
  return res.json(ranked)
})

app.post("/view", (req, res) => {
  const { id, user } = req.body
  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(Number(id))

  if (!video) {
    return res.status(404).json({ error: "Vídeo não encontrado" })
  }

  if (!user) {
    return res.status(400).json({ error: "Utilizador obrigatório" })
  }

  if (!getUserByUsername(String(user))) {
    return res.status(404).json({ error: "Utilizador não encontrado" })
  }

  db.prepare(`
    INSERT INTO video_views (video_id, username, viewed_at)
    VALUES (?, ?, ?)
    ON CONFLICT(video_id, username) DO UPDATE SET viewed_at = excluded.viewed_at
  `).run(video.id, String(user), Date.now())
  return res.json(decorateVideo(video, String(user)))
})

app.post("/like", (req, res) => {
  const { id, user } = req.body
  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(Number(id))

  if (!video) {
    return res.status(404).json({ error: "Vídeo não encontrado" })
  }

  if (!user) {
    return res.status(400).json({ error: "Utilizador obrigatório" })
  }

  if (!getUserByUsername(String(user))) {
    return res.status(404).json({ error: "Utilizador não encontrado" })
  }

  const alreadyLiked = db.prepare("SELECT 1 FROM video_likes WHERE video_id = ? AND username = ? LIMIT 1").get(video.id, String(user))
  if (alreadyLiked) {
    db.prepare("DELETE FROM video_likes WHERE video_id = ? AND username = ?").run(video.id, String(user))
  } else {
    db.prepare("INSERT OR IGNORE INTO video_likes (video_id, username) VALUES (?, ?)").run(video.id, String(user))
  }
  return res.json(decorateVideo(video, String(user)))
})

app.post("/comment", (req, res) => {
  const { id, user, author, comment } = req.body
  const text = String(comment || "").trim()
  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(Number(id))

  if (!video) {
    return res.status(404).json({ error: "Vídeo não encontrado" })
  }

  if (!text) {
    return res.status(400).json({ error: "Comentário vazio" })
  }

  const commentId = Date.now()
  db.prepare(`
    INSERT INTO comments (id, video_id, user_display, text, author_username, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    commentId,
    video.id,
    String(user || "Anónimo"),
    text,
    String(author || "").trim(),
    commentId
  )

  return res.json(decorateVideo(video, String(author || "")))
})

app.post("/comment/delete", (req, res) => {
  const { id, commentId, user } = req.body
  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(Number(id))

  if (!video) {
    return res.status(404).json({ error: "Vídeo não encontrado" })
  }

  if (!user) {
    return res.status(400).json({ error: "Utilizador obrigatório" })
  }

  const comment = db.prepare("SELECT * FROM comments WHERE id = ? AND video_id = ?").get(Number(commentId), video.id)

  if (!comment) {
    return res.status(404).json({ error: "Comentário não encontrado" })
  }

  const canDelete = video.user_username === String(user) || comment.author_username === String(user) || comment.user_display === String(user)

  if (!canDelete) {
    return res.status(403).json({ error: "Sem permissão para apagar comentário" })
  }

  db.prepare("DELETE FROM comments WHERE id = ?").run(comment.id)
  return res.json(decorateVideo(video, String(user)))
})

app.post("/follow", (req, res) => {
  const follower = String(req.body.follower || "").trim()
  const following = String(req.body.following || "").trim()

  if (!follower || !following) {
    return res.status(400).json({ error: "Follow inválido" })
  }

  if (follower === following) {
    return res.status(400).json({ error: "Não podes seguir a tua própria conta" })
  }

  if (!getUserByUsername(follower) || !getUserByUsername(following)) {
    return res.status(404).json({ error: "Utilizador não encontrado" })
  }

  db.prepare("INSERT OR IGNORE INTO follows (follower, following) VALUES (?, ?)").run(follower, following)
  return res.json({ ok: true })
})

app.post("/unfollow", (req, res) => {
  const follower = String(req.body.follower || "").trim()
  const following = String(req.body.following || "").trim()

  if (!follower || !following) {
    return res.status(400).json({ error: "Unfollow inválido" })
  }

  if (!getUserByUsername(follower) || !getUserByUsername(following)) {
    return res.status(404).json({ error: "Utilizador não encontrado" })
  }

  db.prepare("DELETE FROM follows WHERE follower = ? AND following = ?").run(follower, following)
  return res.json({ ok: true })
})

app.get("/following/:user", (req, res) => {
  const user = String(req.params.user || "")
  const searchTerm = String(req.query.q || "").trim().toLowerCase()

  const videos = db.prepare(`
    SELECT v.*
    FROM videos v
    INNER JOIN follows f ON f.following = v.user_username
    WHERE f.follower = ?
    ORDER BY v.created_at DESC
  `).all(user)

  const filtered = filterVideosBySearch(videos, searchTerm)
  const decorated = filtered.map(video => decorateVideo(video, user))
  const ranked = searchTerm ? decorated.sort(sortByViewsThenRecent) : decorated
  return res.json(ranked)
})

app.get("/profile/:username", (req, res) => {
  const username = String(req.params.username || "").trim()
  const user = getUserByUsername(username)

  if (!user) {
    return res.status(404).json({ error: "Perfil não encontrado" })
  }

  const videos = db
    .prepare("SELECT * FROM videos WHERE user_username = ? ORDER BY id DESC")
    .all(user.username)
    .map(video => decorateVideo(video, user.username))

  const followers = getRowValue(db.prepare("SELECT COUNT(*) AS count FROM follows WHERE following = ?").get(user.username), "count")
  const following = getRowValue(db.prepare("SELECT COUNT(*) AS count FROM follows WHERE follower = ?").get(user.username), "count")

  return res.json({
    user: getSafeUser(user),
    videos,
    followers,
    following
  })
})

app.post("/profile/update", (req, res) => {
  const username = String(req.body.username || "").trim()
  const displayName = String(req.body.displayName || "").trim()
  const avatar = String(req.body.avatar || "")

  const user = getUserByUsername(username)

  if (!user) {
    return res.status(404).json({ error: "Perfil não encontrado" })
  }

  if (!displayName) {
    return res.status(400).json({ error: "Nome do canal obrigatório" })
  }

  db.prepare("UPDATE users SET display_name = ?, avatar = ? WHERE username = ?").run(displayName, avatar, username)
  return res.json(getSafeUser(getUserByUsername(username)))
})

app.get("/health", (req, res) => {
  res.json({ ok: true, database: "sqlite" })
})

app.use((error, req, res, next) => {
  if (error && error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Vídeo demasiado grande (máx. 500MB)" })
  }

  if (error) {
    return res.status(400).json({ error: error.message || "Erro no upload" })
  }

  return next()
})

app.listen(PORT, () => {
  console.log(`ScootTok running 🛴 on port ${PORT}`)
})
