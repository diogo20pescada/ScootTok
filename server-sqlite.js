const express = require("express")
const multer = require("multer")
const fs = require("fs")
const cors = require("cors")
const path = require("path")
const crypto = require("crypto")
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")
const Database = require("better-sqlite3")

const app = express()
const PORT = Number(process.env.PORT) || 3000
const ROOT_DIR = __dirname
const PUBLIC_DIR = path.join(ROOT_DIR, "public")
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT_DIR
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(DATA_DIR, "uploads")
const LEGACY_DB_JSON_PATH = process.env.LEGACY_DB_JSON_PATH
  ? path.resolve(process.env.LEGACY_DB_JSON_PATH)
  : path.join(ROOT_DIR, "database.json")
const SQLITE_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(DATA_DIR, "scoottok.db")
const MODERATOR_USERS = String(process.env.MODERATOR_USERS || "").split(",").map(item => item.trim()).filter(Boolean)

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
    avatar TEXT NOT NULL DEFAULT '',
    login_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY,
    user_username TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL,
    mimetype TEXT NOT NULL DEFAULT '',
    thumbnail TEXT NOT NULL DEFAULT '',
    video_hash TEXT NOT NULL DEFAULT '',
    music_license TEXT NOT NULL DEFAULT '',
    image_license TEXT NOT NULL DEFAULT '',
    music_license_proof TEXT NOT NULL DEFAULT '',
    image_license_proof TEXT NOT NULL DEFAULT '',
    rights_declaration INTEGER NOT NULL DEFAULT 0,
    moderation_status TEXT NOT NULL DEFAULT 'approved',
    moderation_reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_username) REFERENCES users(username) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS compliance_audit (
    id INTEGER PRIMARY KEY,
    event_type TEXT NOT NULL,
    user_username TEXT NOT NULL DEFAULT '',
    video_id INTEGER,
    severity TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS takedown_requests (
    id INTEGER PRIMARY KEY,
    reporter_email TEXT NOT NULL,
    claimant_name TEXT NOT NULL,
    video_id INTEGER,
    target_username TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL,
    evidence_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    resolution_note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER NOT NULL DEFAULT 0,
    resolved_by TEXT NOT NULL DEFAULT ''
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
  CREATE INDEX IF NOT EXISTS idx_videos_hash ON videos(video_hash);
  CREATE INDEX IF NOT EXISTS idx_videos_moderation_status ON videos(moderation_status);
  CREATE INDEX IF NOT EXISTS idx_compliance_audit_created_at ON compliance_audit(created_at);
  CREATE INDEX IF NOT EXISTS idx_takedown_status ON takedown_requests(status);
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

try {
  db.exec(`ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0`)
} catch (_) {}

try {
  db.exec(`ALTER TABLE videos ADD COLUMN video_hash TEXT NOT NULL DEFAULT ''`)
} catch (_) {}

try {
  db.exec(`ALTER TABLE videos ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'approved'`)
} catch (_) {}

try {
  db.exec(`ALTER TABLE videos ADD COLUMN moderation_reason TEXT NOT NULL DEFAULT ''`)
} catch (_) {}

try {
  db.exec(`ALTER TABLE videos ADD COLUMN music_license TEXT NOT NULL DEFAULT ''`)
} catch (_) {}

try {
  db.exec(`ALTER TABLE videos ADD COLUMN image_license TEXT NOT NULL DEFAULT ''`)
} catch (_) {}

try {
  db.exec(`ALTER TABLE videos ADD COLUMN music_license_proof TEXT NOT NULL DEFAULT ''`)
} catch (_) {}

try {
  db.exec(`ALTER TABLE videos ADD COLUMN image_license_proof TEXT NOT NULL DEFAULT ''`)
} catch (_) {}

try {
  db.exec(`ALTER TABLE videos ADD COLUMN rights_declaration INTEGER NOT NULL DEFAULT 0`)
} catch (_) {}

const REQUIRED_SCOOTER_KEYWORDS = [
  "trotinete",
  "scooter",
  "scooter eletrica",
  "scooter elétrica",
  "e-scooter",
  "patinete"
]

const BLOCKED_COPY_KEYWORDS = [
  "tiktok",
  "youtube",
  "instagram",
  "reels",
  "shorts",
  "copiado"
]

const BLOCKED_CONTENT_KEYWORDS = [
  "porno",
  "porn",
  "nude",
  "nudity",
  "gore",
  "violencia extrema",
  "violência extrema"
]

const MODERATION_PENDING_REASON = "Aguarda revisão: confirmar presença de trotinete elétrica no vídeo"
const ALLOWED_MUSIC_LICENSES = new Set(["original", "creative-commons", "licensed", "no-audio"])
const ALLOWED_IMAGE_LICENSES = new Set(["original", "creative-commons", "licensed", "none"])
const PROOF_REQUIRED_LICENSES = new Set(["creative-commons", "licensed"])
const COPYRIGHT_RISK_TERMS = [
  "download",
  "reupload",
  "rip",
  "sem creditos",
  "sem créditos",
  "copyright",
  "tiktok",
  "youtube",
  "instagram"
]

function isApprovedVideo(video) {
  return String(video?.moderation_status || "").toLowerCase() === "approved"
}

function isModerator(username) {
  return MODERATOR_USERS.includes(String(username || "").trim())
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value || {})
  } catch (_) {
    return "{}"
  }
}

function logComplianceEvent({ eventType, userUsername = "", videoId = null, severity = "info", message, details = {} }) {
  db.prepare(`
    INSERT INTO compliance_audit (id, event_type, user_username, video_id, severity, message, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Date.now() + Math.floor(Math.random() * 1000),
    String(eventType || "compliance-event"),
    String(userUsername || ""),
    videoId === null || videoId === undefined ? null : Number(videoId),
    String(severity || "info"),
    String(message || ""),
    safeJsonStringify(details),
    Date.now()
  )
}

function getRowValue(row, key, fallback = 0) {
  if (!row) {
    return fallback
  }

  const value = row[key]
  return typeof value === "number" ? value : fallback
}

function normalizeModerationText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function includesAnyKeyword(text, keywords) {
  const normalizedText = normalizeModerationText(text)
  return keywords.some(keyword => normalizedText.includes(normalizeModerationText(keyword)))
}

function tokenizeText(value) {
  return normalizeModerationText(value)
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 2)
}

function jaccardSimilarity(aText, bText) {
  const aSet = new Set(tokenizeText(aText))
  const bSet = new Set(tokenizeText(bText))

  if (!aSet.size || !bSet.size) {
    return 0
  }

  let intersection = 0
  for (const token of aSet) {
    if (bSet.has(token)) {
      intersection += 1
    }
  }

  const union = new Set([...aSet, ...bSet]).size
  return union ? intersection / union : 0
}

function normalizeLicenseValue(value) {
  return String(value || "").trim().toLowerCase()
}

function isValidProofValue(value) {
  const text = String(value || "").trim()
  if (!text) {
    return false
  }

  if (text.length >= 8) {
    return true
  }

  return /^https?:\/\//i.test(text)
}

function analyzePotentialMetadataPlagiarism({ title, desc }) {
  const sourceText = `${title || ""} ${desc || ""}`.trim()
  if (!sourceText) {
    return { score: 0, suspectedVideoId: null }
  }

  const candidateVideos = db
    .prepare("SELECT id, title, description FROM videos ORDER BY created_at DESC LIMIT 500")
    .all()

  let bestScore = 0
  let suspectedVideoId = null

  candidateVideos.forEach(video => {
    const candidateText = `${video.title || ""} ${video.description || ""}`.trim()
    const score = jaccardSimilarity(sourceText, candidateText)
    if (score > bestScore) {
      bestScore = score
      suspectedVideoId = video.id
    }
  })

  return {
    score: Number(bestScore.toFixed(3)),
    suspectedVideoId
  }
}

function runLocalAiComplianceAnalysis({
  title,
  desc,
  originalFileName,
  musicLicense,
  imageLicense,
  musicLicenseProof,
  imageLicenseProof,
  rightsDeclaration,
  videoHash
}) {
  const decisions = []
  const warnings = []
  const rawText = `${title || ""} ${desc || ""} ${originalFileName || ""}`

  const normalizedMusicLicense = normalizeLicenseValue(musicLicense)
  const normalizedImageLicense = normalizeLicenseValue(imageLicense)

  if (!ALLOWED_MUSIC_LICENSES.has(normalizedMusicLicense)) {
    decisions.push("Direitos de música inválidos ou não declarados")
  }

  if (!ALLOWED_IMAGE_LICENSES.has(normalizedImageLicense)) {
    decisions.push("Direitos de imagem/capa inválidos ou não declarados")
  }

  if (PROOF_REQUIRED_LICENSES.has(normalizedMusicLicense) && !isValidProofValue(musicLicenseProof)) {
    decisions.push("Falta prova válida de licença de música")
  }

  if (PROOF_REQUIRED_LICENSES.has(normalizedImageLicense) && !isValidProofValue(imageLicenseProof)) {
    decisions.push("Falta prova válida de licença de imagem/capa")
  }

  if (!rightsDeclaration) {
    decisions.push("Declaração de direitos não confirmada")
  }

  if (includesAnyKeyword(rawText, COPYRIGHT_RISK_TERMS)) {
    warnings.push("Termos com risco de direitos autorais detetados")
  }

  if (!includesAnyKeyword(rawText, REQUIRED_SCOOTER_KEYWORDS)) {
    warnings.push("IA não encontrou indicação clara de trotinete nos metadados")
  }

  const plagiarism = analyzePotentialMetadataPlagiarism({ title, desc })
  if (plagiarism.score >= 0.82) {
    decisions.push(`Risco elevado de plágio textual (${plagiarism.score})`)
  } else if (plagiarism.score >= 0.65) {
    warnings.push(`Similaridade textual moderada (${plagiarism.score})`)
  }

  const baseModeration = moderateVideoMetadata({
    title,
    desc,
    fileName: originalFileName,
    videoHash
  })

  if (!baseModeration.ok) {
    decisions.push(baseModeration.error)
  }

  const severity = decisions.length ? "high" : warnings.length ? "medium" : "low"
  const accepted = decisions.length === 0
  const requiresManualReview = accepted && warnings.length > 0
  const autoApproved = accepted && !requiresManualReview
  const summary = !accepted
    ? "Análise concluiu risco alto: upload bloqueado."
    : requiresManualReview
      ? "Análise concluída: vídeo enviado para revisão manual."
      : "Análise concluída: vídeo aprovado automaticamente."

  return {
    summary,
    severity,
    accepted,
    requiresManualReview,
    autoApproved,
    decisions,
    warnings,
    rightsDeclaration: Boolean(rightsDeclaration),
    plagiarismScore: plagiarism.score,
    suspectedVideoId: plagiarism.suspectedVideoId,
    violationType: baseModeration.violationType || "none"
  }
}

function computeFileSha256(filePath) {
  const buffer = fs.readFileSync(filePath)
  return crypto.createHash("sha256").update(buffer).digest("hex")
}

function moderateVideoMetadata({ title, desc, fileName, videoHash }) {
  const contextText = `${title || ""} ${desc || ""} ${fileName || ""}`

  if (includesAnyKeyword(contextText, BLOCKED_CONTENT_KEYWORDS)) {
    return {
      ok: false,
      error: "Conteúdo rejeitado por palavras de conteúdo indesejado",
      violationType: "blocked-content"
    }
  }

  if (includesAnyKeyword(contextText, BLOCKED_COPY_KEYWORDS)) {
    return {
      ok: false,
      error: "Conteúdo rejeitado por referência a plataforma externa/cópia",
      violationType: "external-copy"
    }
  }

  if (videoHash) {
    const duplicateVideo = db
      .prepare("SELECT id FROM videos WHERE video_hash = ? LIMIT 1")
      .get(videoHash)

    if (duplicateVideo) {
      return {
        ok: false,
        error: "Vídeo duplicado detetado (hash idêntico)",
        violationType: "duplicate"
      }
    }
  }

  return { ok: true, violationType: "none" }
}

function deleteUploadAsset(fileName) {
  const safeName = String(fileName || "").trim()
  if (!safeName) {
    return
  }

  const uploadsRoot = path.resolve(UPLOADS_DIR)
  const filePath = path.resolve(uploadsRoot, safeName)

  if (!filePath.startsWith(uploadsRoot + path.sep)) {
    return
  }

  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath)
    } catch (_) {}
  }
}

function banUserAndPurgeContent(username, reason) {
  const cleanUsername = String(username || "").trim()
  if (!cleanUsername) {
    return { banned: false, removedVideos: 0 }
  }

  const user = getUserByUsername(cleanUsername)
  if (!user) {
    return { banned: false, removedVideos: 0 }
  }

  const videos = db
    .prepare("SELECT id, file_name, thumbnail FROM videos WHERE user_username = ?")
    .all(cleanUsername)

  videos.forEach(video => {
    deleteUploadAsset(video.file_name)
    deleteUploadAsset(video.thumbnail)
  })

  db.prepare("DELETE FROM users WHERE username = ?").run(cleanUsername)
  persistLegacyJsonSnapshot()

  console.warn(`Utilizador banido: ${cleanUsername}. Motivo: ${String(reason || "não especificado")}`)
  return { banned: true, removedVideos: videos.length }
}

function purgeAllVideosAndRelations() {
  const videos = db.prepare("SELECT id, file_name, thumbnail FROM videos").all()
  videos.forEach(video => {
    deleteUploadAsset(video.file_name)
    deleteUploadAsset(video.thumbnail)
  })

  db.prepare("DELETE FROM comments").run()
  db.prepare("DELETE FROM video_likes").run()
  db.prepare("DELETE FROM video_views").run()
  db.prepare("DELETE FROM videos").run()
  persistLegacyJsonSnapshot()

  return { removedVideos: videos.length }
}

function extensionFromImageMime(mimeType) {
  const normalized = String(mimeType || "").toLowerCase()
  if (normalized === "image/png") return ".png"
  if (normalized === "image/webp") return ".webp"
  if (normalized === "image/gif") return ".gif"
  if (normalized === "image/bmp") return ".bmp"
  if (normalized === "image/svg+xml") return ".svg"
  return ".jpg"
}

function saveThumbnailDataUrl(thumbnailData) {
  const trimmed = String(thumbnailData || "").trim()
  const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/)

  if (!match) {
    throw new Error("Formato de capa inválido")
  }

  const mimeType = match[1]
  const base64 = match[2].replace(/\s+/g, "")
  const buffer = Buffer.from(base64, "base64")

  if (!buffer.length) {
    throw new Error("Capa vazia")
  }

  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extensionFromImageMime(mimeType)}`
  const filePath = path.join(UPLOADS_DIR, filename)
  fs.writeFileSync(filePath, buffer)
  return filename
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
    INSERT OR IGNORE INTO users (id, username, password, display_name, avatar, login_count)
    VALUES (@id, @username, @password, @display_name, @avatar, @login_count)
  `)

  const insertVideo = db.prepare(`
    INSERT OR IGNORE INTO videos (id, user_username, title, description, file_name, mimetype, thumbnail, video_hash, music_license, image_license, music_license_proof, image_license_proof, rights_declaration, moderation_status, moderation_reason, created_at)
    VALUES (@id, @user_username, @title, @description, @file_name, @mimetype, @thumbnail, @video_hash, @music_license, @image_license, @music_license_proof, @image_license_proof, @rights_declaration, @moderation_status, @moderation_reason, @created_at)
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
        avatar: String(user.avatar || ""),
        login_count: Number(user.loginCount) || 0
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
        thumbnail: String(video.thumbnail || ""),
        video_hash: String(video.videoHash || ""),
        music_license: String(video.musicLicense || ""),
        image_license: String(video.imageLicense || ""),
        music_license_proof: String(video.musicLicenseProof || ""),
        image_license_proof: String(video.imageLicenseProof || ""),
        rights_declaration: Number(video.rightsDeclaration) ? 1 : 0,
        moderation_status: String(video.moderationStatus || "approved"),
        moderation_reason: String(video.moderationReason || ""),
        created_at: Number(video.createdAt) || videoId
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

  persistLegacyJsonSnapshot()
}

function buildLegacyJsonSnapshot() {
  const users = db
    .prepare("SELECT id, username, password, display_name, avatar, login_count FROM users ORDER BY id ASC")
    .all()
    .map(user => ({
      id: user.id,
      username: user.username,
      password: user.password,
      displayName: user.display_name,
      avatar: user.avatar || "",
      loginCount: Number(user.login_count) || 0
    }))

  const follows = db
    .prepare("SELECT follower, following FROM follows ORDER BY follower ASC, following ASC")
    .all()

  const getLikesByVideoId = db.prepare("SELECT username FROM video_likes WHERE video_id = ? ORDER BY username ASC")
  const getViewsByVideoId = db.prepare("SELECT username FROM video_views WHERE video_id = ? ORDER BY viewed_at DESC, username ASC")
  const getSnapshotCommentsByVideoId = db.prepare(`
    SELECT id, user_display, text, author_username, created_at
    FROM comments
    WHERE video_id = ?
    ORDER BY id ASC
  `)

  const videos = db
    .prepare("SELECT * FROM videos ORDER BY created_at DESC")
    .all()
    .map(video => ({
      id: video.id,
      user: video.user_username,
      title: video.title,
      desc: video.description || "",
      file: video.file_name,
      mimetype: video.mimetype || "",
      thumbnail: video.thumbnail || "",
      videoHash: video.video_hash || "",
      musicLicense: video.music_license || "",
      imageLicense: video.image_license || "",
      musicLicenseProof: video.music_license_proof || "",
      imageLicenseProof: video.image_license_proof || "",
      rightsDeclaration: Number(video.rights_declaration) || 0,
      moderationStatus: video.moderation_status || "approved",
      moderationReason: video.moderation_reason || "",
      createdAt: video.created_at || video.id,
      likedBy: getLikesByVideoId.all(video.id).map(row => row.username),
      viewedBy: getViewsByVideoId.all(video.id).map(row => row.username),
      comments: getSnapshotCommentsByVideoId.all(video.id).map(comment => ({
        id: comment.id,
        user: comment.user_display || "Anónimo",
        text: comment.text || "",
        author: comment.author_username || "",
        createdAt: comment.created_at || comment.id
      }))
    }))

  return { users, videos, follows }
}

function persistLegacyJsonSnapshot() {
  try {
    const snapshot = buildLegacyJsonSnapshot()
    const tempPath = `${LEGACY_DB_JSON_PATH}.tmp`
    fs.mkdirSync(path.dirname(LEGACY_DB_JSON_PATH), { recursive: true })
    fs.writeFileSync(tempPath, JSON.stringify(snapshot, null, 2), "utf8")
    fs.renameSync(tempPath, LEGACY_DB_JSON_PATH)
  } catch (error) {
    console.error("Falha ao atualizar database.json:", error)
  }
}

function getSafeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatar: user.avatar || "",
    loginCount: Number(user.login_count) || 0
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
      id: String(comment.id),
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
    videoHash: video.video_hash || "",
    musicLicense: video.music_license || "",
    imageLicense: video.image_license || "",
    musicLicenseProof: video.music_license_proof || "",
    imageLicenseProof: video.image_license_proof || "",
    rightsDeclaration: Number(video.rights_declaration) || 0,
    moderationStatus: video.moderation_status || "approved",
    moderationReason: video.moderation_reason || "",
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
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false
}))
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados pedidos. Tenta novamente mais tarde." }
}))
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
    INSERT INTO users (id, username, password, display_name, avatar, login_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, username, password, username, "", 0)

  persistLegacyJsonSnapshot()

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

  db.prepare("UPDATE users SET login_count = login_count + 1 WHERE username = ?").run(username)
  persistLegacyJsonSnapshot()

  return res.json(getSafeUser(getUserByUsername(username)))
})

app.post("/upload", uploadHandler, (req, res) => {
  const user = String(req.body.user || "").trim()
  const title = String(req.body.title || "").trim()
  const desc = String(req.body.desc || "").trim()
  const musicLicense = String(req.body.musicLicense || "").trim()
  const imageLicense = String(req.body.imageLicense || "").trim()
  const musicLicenseProof = String(req.body.musicLicenseProof || "").trim()
  const imageLicenseProof = String(req.body.imageLicenseProof || "").trim()
  const rightsDeclaration = String(req.body.rightsDeclaration || "") === "1"
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

  if (!MODERATOR_USERS.length) {
    try {
      if (videoFile?.filename) {
        const tempVideoPath = path.resolve(UPLOADS_DIR, String(videoFile.filename || ""))
        if (tempVideoPath.startsWith(path.resolve(UPLOADS_DIR) + path.sep) && fs.existsSync(tempVideoPath)) {
          fs.unlinkSync(tempVideoPath)
        }
      }

      if (thumbnailFile?.filename) {
        const tempThumbPath = path.resolve(UPLOADS_DIR, String(thumbnailFile.filename || ""))
        if (tempThumbPath.startsWith(path.resolve(UPLOADS_DIR) + path.sep) && fs.existsSync(tempThumbPath)) {
          fs.unlinkSync(tempThumbPath)
        }
      }
    } catch (_) {}

    return res.status(503).json({ error: "Uploads desativados até configurar MODERATOR_USERS" })
  }

  const videoPath = path.resolve(UPLOADS_DIR, String(videoFile.filename || ""))
  if (!videoPath.startsWith(path.resolve(UPLOADS_DIR) + path.sep) || !fs.existsSync(videoPath)) {
    return res.status(400).json({ error: "Ficheiro de vídeo inválido" })
  }

  const videoHash = computeFileSha256(videoPath)
  const analysis = runLocalAiComplianceAnalysis({
    title,
    desc,
    originalFileName: videoFile.originalname || videoFile.filename,
    musicLicense,
    imageLicense,
    musicLicenseProof,
    imageLicenseProof,
    rightsDeclaration,
    videoHash
  })

  if (!analysis.accepted) {
    deleteUploadAsset(videoFile?.filename)
    deleteUploadAsset(thumbnailFile?.filename)

    const mustBan = analysis.violationType === "blocked-content" || analysis.violationType === "external-copy"
    if (mustBan) {
      const banResult = banUserAndPurgeContent(user, analysis.summary)
      logComplianceEvent({
        eventType: "upload-banned",
        userUsername: user,
        severity: "high",
        message: "Conta banida por violação crítica no upload",
        details: { analysis, removedVideos: banResult.removedVideos }
      })
      return res.status(403).json({
        error: "Conta banida por vídeo não permitido. Conta e vídeos removidos.",
        detail: analysis.summary,
        banned: banResult.banned,
        removedVideos: banResult.removedVideos,
        analysis
      })
    }

    logComplianceEvent({
      eventType: "upload-blocked",
      userUsername: user,
      severity: "medium",
      message: analysis.decisions[0] || "Upload bloqueado na análise automática",
      details: { analysis }
    })

    return res.status(400).json({
      error: analysis.decisions[0] || "Upload bloqueado na análise automática",
      analysis
    })
  }

  const moderationStatus = analysis.requiresManualReview ? "pending" : "approved"
  const moderationReason = analysis.requiresManualReview
    ? `${MODERATION_PENDING_REASON} ${analysis.warnings.length ? `Avisos: ${analysis.warnings.join("; ")}` : ""}`.trim()
    : "Aprovado automaticamente pela análise inicial"

  const id = Date.now()
  db.prepare(`
    INSERT INTO videos (id, user_username, title, description, file_name, mimetype, thumbnail, video_hash, music_license, image_license, music_license_proof, image_license_proof, rights_declaration, moderation_status, moderation_reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    user,
    title,
    desc,
    videoFile.filename,
    String(videoFile.mimetype || ""),
    thumbnailFile ? thumbnailFile.filename : "",
    videoHash,
    musicLicense,
    imageLicense,
    musicLicenseProof,
    imageLicenseProof,
    rightsDeclaration ? 1 : 0,
    moderationStatus,
    moderationReason,
    id
  )

  persistLegacyJsonSnapshot()
  if (analysis.requiresManualReview) {
    logComplianceEvent({
      eventType: "upload-pending-review",
      userUsername: user,
      videoId: id,
      severity: analysis.warnings.length ? "medium" : "info",
      message: "Upload enviado para revisão manual",
      details: { analysis }
    })
  } else {
    logComplianceEvent({
      eventType: "upload-auto-approved",
      userUsername: user,
      videoId: id,
      severity: "info",
      message: "Upload aprovado automaticamente",
      details: { analysis }
    })
  }

  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(id)
  return res.json({
    ...decorateVideo(video, user),
    pendingModeration: analysis.requiresManualReview,
    moderationMessage: analysis.requiresManualReview ? MODERATION_PENDING_REASON : "Vídeo aprovado automaticamente.",
    analysis
  })
})

app.post("/video/moderate", (req, res) => {
  const videoId = Number(req.body.id)
  const moderator = String(req.body.moderator || "").trim()
  const approved = Boolean(req.body.approved)
  const reason = String(req.body.reason || "").trim()

  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(videoId)

  if (!video) {
    return res.status(404).json({ error: "Vídeo não encontrado" })
  }

  if (!moderator || !getUserByUsername(moderator)) {
    return res.status(400).json({ error: "Moderador inválido" })
  }

  const isListedModerator = MODERATOR_USERS.includes(moderator)
  const canModerate = isListedModerator

  if (!canModerate) {
    return res.status(403).json({ error: "Sem permissão para moderar" })
  }

  const status = approved ? "approved" : "rejected"
  const moderationReason = reason || (approved ? "Aprovado: vídeo com trotinete" : "Rejeitado na revisão de trotinete")

  if (!approved) {
    const banResult = banUserAndPurgeContent(video.user_username, moderationReason)
    logComplianceEvent({
      eventType: "moderation-rejected-ban",
      userUsername: video.user_username,
      videoId,
      severity: "high",
      message: "Vídeo rejeitado em moderação e conta banida",
      details: { moderator, moderationReason, removedVideos: banResult.removedVideos }
    })
    return res.status(403).json({
      error: "Conta banida por vídeo não permitido. Conta e vídeos removidos.",
      bannedUser: video.user_username,
      banned: banResult.banned,
      removedVideos: banResult.removedVideos,
      moderationReason
    })
  }

  db.prepare("UPDATE videos SET moderation_status = ?, moderation_reason = ? WHERE id = ?")
    .run(status, moderationReason, videoId)

  persistLegacyJsonSnapshot()
  logComplianceEvent({
    eventType: "moderation-approved",
    userUsername: video.user_username,
    videoId,
    severity: "info",
    message: "Vídeo aprovado em moderação",
    details: { moderator, moderationReason }
  })

  const updatedVideo = db.prepare("SELECT * FROM videos WHERE id = ?").get(videoId)
  return res.json(decorateVideo(updatedVideo, moderator))
})

app.post("/video/update", (req, res) => {
  const videoId = Number(req.body.id)
  const user = String(req.body.user || "").trim()
  const title = String(req.body.title || "").trim()
  const desc = String(req.body.desc || "").trim()
  const thumbnailData = String(req.body.thumbnailData || "").trim()

  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(videoId)

  if (!video) {
    return res.status(404).json({ error: "Vídeo não encontrado" })
  }

  if (!user) {
    return res.status(400).json({ error: "Utilizador obrigatório" })
  }

  if (video.user_username !== user) {
    return res.status(403).json({ error: "Sem permissão para editar este vídeo" })
  }

  if (!title) {
    return res.status(400).json({ error: "Nome do vídeo obrigatório" })
  }

  const moderation = moderateVideoMetadata({
    title,
    desc,
    fileName: video.file_name,
    videoHash: ""
  })

  if (!moderation.ok) {
    return res.status(400).json({ error: moderation.error })
  }

  let thumbnail = String(video.thumbnail || "")
  if (thumbnailData) {
    try {
      thumbnail = saveThumbnailDataUrl(thumbnailData)

      if (video.thumbnail) {
        const previousThumbPath = path.resolve(UPLOADS_DIR, String(video.thumbnail || ""))
        if (previousThumbPath.startsWith(path.resolve(UPLOADS_DIR) + path.sep) && fs.existsSync(previousThumbPath)) {
          fs.unlinkSync(previousThumbPath)
        }
      }
    } catch (error) {
      return res.status(400).json({ error: error.message || "Erro ao processar capa" })
    }
  }

  db.prepare("UPDATE videos SET title = ?, description = ?, thumbnail = ? WHERE id = ?")
    .run(title, desc, thumbnail, videoId)

  persistLegacyJsonSnapshot()
  const updatedVideo = db.prepare("SELECT * FROM videos WHERE id = ?").get(videoId)
  return res.json(decorateVideo(updatedVideo, user))
})

app.get("/media/:id", (req, res) => {
  const id = Number(req.params.id)
  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(id)

  if (!video) {
    return res.status(404).json({ error: "Vídeo não encontrado" })
  }

  if (!isApprovedVideo(video)) {
    return res.status(403).json({ error: "Vídeo indisponível até aprovação de moderação" })
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

  if (!isApprovedVideo(video)) {
    return res.status(403).json({ error: "Thumbnail indisponível até aprovação de moderação" })
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
  const allVideos = db.prepare("SELECT * FROM videos WHERE moderation_status = 'approved' ORDER BY created_at DESC").all()
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

  if (!isApprovedVideo(video)) {
    return res.status(403).json({ error: "Vídeo ainda não aprovado" })
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

  persistLegacyJsonSnapshot()
  return res.json(decorateVideo(video, String(user)))
})

app.post("/like", (req, res) => {
  const { id, user } = req.body
  const mode = String(req.body.mode || "toggle").toLowerCase()
  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(Number(id))

  if (!video) {
    return res.status(404).json({ error: "Vídeo não encontrado" })
  }

  if (!isApprovedVideo(video)) {
    return res.status(403).json({ error: "Vídeo ainda não aprovado" })
  }

  if (!user) {
    return res.status(400).json({ error: "Utilizador obrigatório" })
  }

  if (!getUserByUsername(String(user))) {
    return res.status(404).json({ error: "Utilizador não encontrado" })
  }

  const normalizedUser = String(user)
  if (mode === "like") {
    db.prepare("INSERT OR IGNORE INTO video_likes (video_id, username) VALUES (?, ?)").run(video.id, normalizedUser)
  } else if (mode === "unlike") {
    db.prepare("DELETE FROM video_likes WHERE video_id = ? AND username = ?").run(video.id, normalizedUser)
  } else {
    const alreadyLiked = db.prepare("SELECT 1 FROM video_likes WHERE video_id = ? AND username = ? LIMIT 1").get(video.id, normalizedUser)
    if (alreadyLiked) {
      db.prepare("DELETE FROM video_likes WHERE video_id = ? AND username = ?").run(video.id, normalizedUser)
    } else {
      db.prepare("INSERT OR IGNORE INTO video_likes (video_id, username) VALUES (?, ?)").run(video.id, normalizedUser)
    }
  }

  persistLegacyJsonSnapshot()
  return res.json(decorateVideo(video, normalizedUser))
})

app.post("/comment", (req, res) => {
  const { id, user, author, comment } = req.body
  const text = String(comment || "").trim()
  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(Number(id))

  if (!video) {
    return res.status(404).json({ error: "Vídeo não encontrado" })
  }

  if (!isApprovedVideo(video)) {
    return res.status(403).json({ error: "Vídeo ainda não aprovado" })
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

  persistLegacyJsonSnapshot()

  return res.json(decorateVideo(video, String(author || "")))
})

app.post("/comment/delete", (req, res) => {
  const { id, commentId, user } = req.body
  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(Number(id))

  if (!video) {
    return res.status(404).json({ error: "Vídeo não encontrado" })
  }

  if (!isApprovedVideo(video)) {
    return res.status(403).json({ error: "Vídeo ainda não aprovado" })
  }

  if (!user) {
    return res.status(400).json({ error: "Utilizador obrigatório" })
  }

  const normalizedCommentId = String(commentId ?? "").trim()
  if (!normalizedCommentId) {
    return res.status(400).json({ error: "Comentário inválido" })
  }

  let comment = db
    .prepare("SELECT * FROM comments WHERE CAST(id AS TEXT) = ? AND video_id = ?")
    .get(normalizedCommentId, video.id)

  if (!comment && Number.isFinite(Number(normalizedCommentId))) {
    comment = db
      .prepare("SELECT * FROM comments WHERE id = ? AND video_id = ?")
      .get(Number(normalizedCommentId), video.id)
  }

  if (!comment) {
    return res.status(404).json({ error: "Comentário não encontrado" })
  }

  const canDelete = video.user_username === String(user) || comment.author_username === String(user) || comment.user_display === String(user)

  if (!canDelete) {
    return res.status(403).json({ error: "Sem permissão para apagar comentário" })
  }

  db.prepare("DELETE FROM comments WHERE id = ?").run(comment.id)
  persistLegacyJsonSnapshot()
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
  persistLegacyJsonSnapshot()
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
  persistLegacyJsonSnapshot()
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
      AND v.moderation_status = 'approved'
    ORDER BY v.created_at DESC
  `).all(user)

  const filtered = filterVideosBySearch(videos, searchTerm)
  const decorated = filtered.map(video => decorateVideo(video, user))
  const ranked = searchTerm ? decorated.sort(sortByViewsThenRecent) : decorated
  return res.json(ranked)
})

app.get("/profile/:username", (req, res) => {
  const username = String(req.params.username || "").trim()
  const viewer = String(req.query.viewer || "").trim()
  const user = getUserByUsername(username)

  if (!user) {
    return res.status(404).json({ error: "Perfil não encontrado" })
  }

  const videosQuery = viewer === username
    ? "SELECT * FROM videos WHERE user_username = ? ORDER BY id DESC"
    : "SELECT * FROM videos WHERE user_username = ? AND moderation_status = 'approved' ORDER BY id DESC"

  const videos = db
    .prepare(videosQuery)
    .all(user.username)
    .map(video => decorateVideo(video, viewer || user.username))

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
  persistLegacyJsonSnapshot()
  return res.json(getSafeUser(getUserByUsername(username)))
})

app.get("/compliance/audit", (req, res) => {
  const moderator = String(req.query.moderator || "").trim()
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500))

  if (!isModerator(moderator)) {
    return res.status(403).json({ error: "Acesso restrito a moderadores" })
  }

  const events = db
    .prepare("SELECT * FROM compliance_audit ORDER BY created_at DESC LIMIT ?")
    .all(limit)
    .map(event => ({
      ...event,
      details: (() => {
        try {
          return JSON.parse(event.details_json || "{}")
        } catch (_) {
          return {}
        }
      })()
    }))

  return res.json({ events })
})

app.post("/compliance/takedown", (req, res) => {
  const reporterEmail = String(req.body.reporterEmail || "").trim()
  const claimantName = String(req.body.claimantName || "").trim()
  const reason = String(req.body.reason || "").trim()
  const evidenceUrl = String(req.body.evidenceUrl || "").trim()
  const videoId = req.body.videoId ? Number(req.body.videoId) : null
  const targetUsername = String(req.body.targetUsername || "").trim()

  if (!reporterEmail || !claimantName || !reason) {
    return res.status(400).json({ error: "reporterEmail, claimantName e reason são obrigatórios" })
  }

  const requestId = Date.now()
  db.prepare(`
    INSERT INTO takedown_requests (id, reporter_email, claimant_name, video_id, target_username, reason, evidence_url, status, resolution_note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open', '', ?)
  `).run(requestId, reporterEmail, claimantName, videoId, targetUsername, reason, evidenceUrl, requestId)

  logComplianceEvent({
    eventType: "takedown-created",
    userUsername: targetUsername,
    videoId,
    severity: "high",
    message: "Pedido de takedown criado",
    details: { reporterEmail, claimantName, reason, evidenceUrl }
  })

  return res.status(201).json({ ok: true, requestId })
})

app.post("/compliance/takedown/:id/resolve", (req, res) => {
  const requestId = Number(req.params.id)
  const moderator = String(req.body.moderator || "").trim()
  const action = String(req.body.action || "").trim().toLowerCase()
  const resolutionNote = String(req.body.resolutionNote || "").trim()

  if (!isModerator(moderator)) {
    return res.status(403).json({ error: "Acesso restrito a moderadores" })
  }

  const request = db.prepare("SELECT * FROM takedown_requests WHERE id = ?").get(requestId)
  if (!request) {
    return res.status(404).json({ error: "Pedido de takedown não encontrado" })
  }

  if (!["dismiss", "remove-video", "ban-user"].includes(action)) {
    return res.status(400).json({ error: "Ação inválida" })
  }

  const now = Date.now()
  let removedVideos = 0

  if (action === "remove-video" && request.video_id) {
    const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(Number(request.video_id))
    if (video) {
      deleteUploadAsset(video.file_name)
      deleteUploadAsset(video.thumbnail)
      db.prepare("DELETE FROM videos WHERE id = ?").run(video.id)
      removedVideos = 1
    }
  }

  if (action === "ban-user" && request.target_username) {
    const result = banUserAndPurgeContent(request.target_username, resolutionNote || "Ban por takedown")
    removedVideos = result.removedVideos
  }

  db.prepare(`
    UPDATE takedown_requests
    SET status = ?, resolution_note = ?, resolved_at = ?, resolved_by = ?
    WHERE id = ?
  `).run("closed", resolutionNote || action, now, moderator, requestId)

  logComplianceEvent({
    eventType: "takedown-resolved",
    userUsername: request.target_username,
    videoId: request.video_id,
    severity: action === "dismiss" ? "info" : "high",
    message: `Takedown resolvido com ação: ${action}`,
    details: { moderator, resolutionNote, removedVideos }
  })

  persistLegacyJsonSnapshot()
  return res.json({ ok: true, action, removedVideos })
})

app.post("/compliance/purge-all-videos", (req, res) => {
  const moderator = String(req.body.moderator || "").trim()
  const confirmation = String(req.body.confirmation || "").trim()

  if (!isModerator(moderator)) {
    return res.status(403).json({ error: "Acesso restrito a moderadores" })
  }

  if (confirmation !== "DELETE_ALL_VIDEOS") {
    return res.status(400).json({ error: "Confirmação inválida" })
  }

  const result = purgeAllVideosAndRelations()
  logComplianceEvent({
    eventType: "emergency-purge-all-videos",
    userUsername: moderator,
    severity: "high",
    message: "Purge global de vídeos executado",
    details: { removedVideos: result.removedVideos }
  })

  return res.json({ ok: true, removedVideos: result.removedVideos })
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
