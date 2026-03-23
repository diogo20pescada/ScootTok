const express = require("express")
const multer = require("multer")
const fs = require("fs")
const cors = require("cors")
const path = require("path")
const { createClient } = require("@supabase/supabase-js")
const { v2: cloudinary } = require("cloudinary")

const app = express()
const PORT = Number(process.env.PORT) || 3000
const ROOT_DIR = __dirname
const PUBLIC_DIR = path.join(ROOT_DIR, "public")
const UPLOADS_DIR = path.join(ROOT_DIR, "uploads")
const LEGACY_DB_JSON_PATH = path.join(ROOT_DIR, "database.json")

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no modo Supabase")
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const cloudinaryReady = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME
  && process.env.CLOUDINARY_API_KEY
  && process.env.CLOUDINARY_API_SECRET
)

if (cloudinaryReady) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  })
}

function normalizeUserRow(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    avatar: user.avatar || ""
  }
}

async function getUserByUsername(username) {
  const { data, error } = await supabase
    .from("users")
    .select("id,username,password,display_name,avatar")
    .eq("username", username)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data || null
}

async function isFollowing(follower, following) {
  const { data, error } = await supabase
    .from("follows")
    .select("follower")
    .eq("follower", follower)
    .eq("following", following)
    .maybeSingle()

  if (error) {
    throw error
  }

  return Boolean(data)
}

async function getCommentsByVideoId(videoId) {
  const { data, error } = await supabase
    .from("comments")
    .select("id,user_display,text,author_username")
    .eq("video_id", videoId)
    .order("id", { ascending: true })

  if (error) {
    throw error
  }

  return (data || []).map(comment => ({
    id: comment.id,
    user: comment.user_display || "Anónimo",
    text: comment.text || "",
    author: comment.author_username || ""
  }))
}

async function decorateVideo(video, viewer) {
  const [{ data: owner }, { count: likesCount }, { count: viewsCount }, comments] = await Promise.all([
    supabase
      .from("users")
      .select("id,username,display_name,avatar")
      .eq("username", video.user_username)
      .maybeSingle(),
    supabase
      .from("video_likes")
      .select("video_id", { count: "exact", head: true })
      .eq("video_id", video.id),
    supabase
      .from("video_views")
      .select("video_id", { count: "exact", head: true })
      .eq("video_id", video.id),
    getCommentsByVideoId(video.id)
  ])

  let liked = false
  let viewed = false
  let followed = false

  if (viewer) {
    const [likeRow, viewRow, followValue] = await Promise.all([
      supabase
        .from("video_likes")
        .select("video_id")
        .eq("video_id", video.id)
        .eq("username", viewer)
        .maybeSingle(),
      supabase
        .from("video_views")
        .select("video_id")
        .eq("video_id", video.id)
        .eq("username", viewer)
        .maybeSingle(),
      isFollowing(viewer, video.user_username)
    ])

    liked = Boolean(likeRow.data)
    viewed = Boolean(viewRow.data)
    followed = Boolean(followValue)
  }

  return {
    id: video.id,
    user: video.user_username,
    title: video.title,
    desc: video.description || "",
    file: video.file_name,
    mimetype: video.mimetype || "",
    likes: likesCount || 0,
    views: viewsCount || 0,
    likedBy: [],
    viewedBy: [],
    comments,
    owner: owner
      ? normalizeUserRow(owner)
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

function parseLegacyComment(comment, videoId, index) {
  if (typeof comment === "string") {
    return {
      id: Number(videoId) * 1000 + index,
      user: "Anónimo",
      text: comment,
      author: ""
    }
  }

  return {
    id: Number(comment?.id) || Number(videoId) * 1000 + index,
    user: String(comment?.user || "Anónimo"),
    text: String(comment?.text || ""),
    author: String(comment?.author || "")
  }
}

async function migrateFromLegacyJsonIfNeeded() {
  const { count, error: countError } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })

  if (countError) {
    throw countError
  }

  if ((count || 0) > 0) {
    return
  }

  if (!fs.existsSync(LEGACY_DB_JSON_PATH)) {
    return
  }

  const legacy = JSON.parse(fs.readFileSync(LEGACY_DB_JSON_PATH, "utf8"))
  const users = (Array.isArray(legacy.users) ? legacy.users : [])
    .map(user => ({
      id: Number(user?.id) || Date.now(),
      username: String(user?.username || "").trim(),
      password: String(user?.password || "").trim(),
      display_name: String(user?.displayName || user?.username || "").trim(),
      avatar: String(user?.avatar || "")
    }))
    .filter(user => user.username && user.password)

  if (users.length) {
    const { error } = await supabase.from("users").upsert(users, { onConflict: "username" })
    if (error) {
      throw error
    }
  }

  const videos = (Array.isArray(legacy.videos) ? legacy.videos : []).map(video => ({
    id: Number(video?.id) || Date.now(),
    user_username: String(video?.user || "").trim(),
    title: String(video?.title || "Sem título"),
    description: String(video?.desc || ""),
    file_name: String(video?.file || ""),
    mimetype: String(video?.mimetype || ""),
    created_at: Number(video?.id) || Date.now()
  })).filter(video => video.user_username)

  if (videos.length) {
    const { error } = await supabase.from("videos").upsert(videos, { onConflict: "id" })
    if (error) {
      throw error
    }
  }

  const follows = (Array.isArray(legacy.follows) ? legacy.follows : [])
    .map(row => ({
      follower: String(row?.follower || "").trim(),
      following: String(row?.following || "").trim()
    }))
    .filter(row => row.follower && row.following && row.follower !== row.following)

  if (follows.length) {
    const { error } = await supabase.from("follows").upsert(follows, { onConflict: "follower,following" })
    if (error) {
      throw error
    }
  }

  const likes = []
  const views = []
  const comments = []

  ;(Array.isArray(legacy.videos) ? legacy.videos : []).forEach(video => {
    const videoId = Number(video?.id)
    if (!videoId) {
      return
    }

    ;(Array.isArray(video?.likedBy) ? video.likedBy : []).forEach(username => {
      const cleanUsername = String(username || "").trim()
      if (cleanUsername) {
        likes.push({ video_id: videoId, username: cleanUsername })
      }
    })

    ;(Array.isArray(video?.viewedBy) ? video.viewedBy : []).forEach(username => {
      const cleanUsername = String(username || "").trim()
      if (cleanUsername) {
        views.push({ video_id: videoId, username: cleanUsername })
      }
    })

    ;(Array.isArray(video?.comments) ? video.comments : []).forEach((comment, index) => {
      const parsed = parseLegacyComment(comment, videoId, index)
      comments.push({
        id: parsed.id,
        video_id: videoId,
        user_display: parsed.user,
        text: parsed.text,
        author_username: parsed.author,
        created_at: parsed.id
      })
    })
  })

  if (likes.length) {
    const { error } = await supabase.from("video_likes").upsert(likes, { onConflict: "video_id,username" })
    if (error) {
      throw error
    }
  }

  if (views.length) {
    const { error } = await supabase.from("video_views").upsert(views, { onConflict: "video_id,username" })
    if (error) {
      throw error
    }
  }

  if (comments.length) {
    const { error } = await supabase.from("comments").upsert(comments, { onConflict: "id" })
    if (error) {
      throw error
    }
  }
}

app.use(express.json({ limit: "10mb" }))
app.use(cors())
app.use(express.static(PUBLIC_DIR))
app.use("/uploads", express.static(UPLOADS_DIR))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 500
  },
  fileFilter: (req, file, callback) => {
    if (!String(file.mimetype || "").startsWith("video/")) {
      return callback(new Error("Só ficheiros de vídeo são permitidos"))
    }

    callback(null, true)
  }
})

async function uploadToCloudinary(fileBuffer, mimetype) {
  if (!cloudinaryReady) {
    throw new Error("Cloudinary não configurado")
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "video",
        folder: "scoottok"
      },
      (error, result) => {
        if (error) {
          reject(error)
          return
        }

        resolve(result)
      }
    )

    uploadStream.end(fileBuffer)
  })
}

app.post("/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim()
    const password = String(req.body.password || "").trim()

    if (!username || !password) {
      return res.status(400).json({ error: "Preenche username e password" })
    }

    const existing = await getUserByUsername(username)
    if (existing) {
      return res.status(409).json({ error: "Esse username já existe" })
    }

    const id = Date.now()
    const { error } = await supabase
      .from("users")
      .insert([{ id, username, password, display_name: username, avatar: "" }])

    if (error) {
      throw error
    }

    const user = await getUserByUsername(username)
    return res.json(normalizeUserRow(user))
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao registar" })
  }
})

app.post("/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim()
    const password = String(req.body.password || "").trim()

    const { data, error } = await supabase
      .from("users")
      .select("id,username,display_name,avatar")
      .eq("username", username)
      .eq("password", password)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!data) {
      return res.status(401).json({ error: "Erro login" })
    }

    return res.json(normalizeUserRow(data))
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro no login" })
  }
})

app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    const user = String(req.body.user || "").trim()
    const title = String(req.body.title || "").trim()
    const desc = String(req.body.desc || "").trim()

    if (!req.file) {
      return res.status(400).json({ error: "Escolhe um vídeo" })
    }

    if (!title) {
      return res.status(400).json({ error: "Título obrigatório" })
    }

    if (!await getUserByUsername(user)) {
      return res.status(404).json({ error: "Utilizador não encontrado" })
    }

    const id = Date.now()
    let fileName = `${id}.mp4`

    if (cloudinaryReady) {
      const result = await uploadToCloudinary(req.file.buffer, req.file.mimetype)
      fileName = String(result.secure_url)
    } else {
      const ext = path.extname(req.file.originalname || "") || ".mp4"
      const localName = `${id}-${Math.round(Math.random() * 1e9)}${ext.toLowerCase()}`
      fs.writeFileSync(path.join(UPLOADS_DIR, localName), req.file.buffer)
      fileName = localName
    }

    const { error } = await supabase.from("videos").insert([{
      id,
      user_username: user,
      title,
      description: desc,
      file_name: fileName,
      mimetype: String(req.file.mimetype || ""),
      created_at: id
    }])

    if (error) {
      throw error
    }

    const { data: video, error: videoError } = await supabase
      .from("videos")
      .select("*")
      .eq("id", id)
      .single()

    if (videoError) {
      throw videoError
    }

    return res.json(await decorateVideo(video, user))
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro no upload" })
  }
})

app.get("/media/:id", async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { data: video, error } = await supabase
      .from("videos")
      .select("id,file_name,mimetype")
      .eq("id", id)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!video) {
      return res.status(404).json({ error: "Vídeo não encontrado" })
    }

    if (String(video.file_name || "").startsWith("http://") || String(video.file_name || "").startsWith("https://")) {
      return res.redirect(video.file_name)
    }

    const uploadsRoot = path.resolve(UPLOADS_DIR)
    const mediaPath = path.resolve(uploadsRoot, String(video.file_name || ""))

    if (!mediaPath.startsWith(uploadsRoot + path.sep)) {
      return res.status(400).json({ error: "Caminho de vídeo inválido" })
    }

    if (!fs.existsSync(mediaPath)) {
      return res.status(404).json({ error: "Ficheiro de vídeo não encontrado" })
    }

    res.type(video.mimetype || "video/mp4")
    return res.sendFile(mediaPath)
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro no media" })
  }
})

app.get("/videos", async (req, res) => {
  try {
    const viewer = req.query.viewer ? String(req.query.viewer) : ""
    const { data, error } = await supabase.from("videos").select("*").order("id", { ascending: false })

    if (error) {
      throw error
    }

    const videos = await Promise.all((data || []).map(video => decorateVideo(video, viewer)))
    return res.json(videos)
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao carregar vídeos" })
  }
})

app.post("/view", async (req, res) => {
  try {
    const { id, user } = req.body
    const viewer = String(user || "")

    const { data: video } = await supabase.from("videos").select("*").eq("id", Number(id)).maybeSingle()
    if (!video) {
      return res.status(404).json({ error: "Vídeo não encontrado" })
    }

    if (!viewer) {
      return res.status(400).json({ error: "Utilizador obrigatório" })
    }

    if (!await getUserByUsername(viewer)) {
      return res.status(404).json({ error: "Utilizador não encontrado" })
    }

    const { error } = await supabase.from("video_views").upsert([{ video_id: video.id, username: viewer }], { onConflict: "video_id,username" })
    if (error) {
      throw error
    }

    return res.json(await decorateVideo(video, viewer))
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao contar view" })
  }
})

app.post("/like", async (req, res) => {
  try {
    const { id, user } = req.body
    const liker = String(user || "")

    const { data: video } = await supabase.from("videos").select("*").eq("id", Number(id)).maybeSingle()
    if (!video) {
      return res.status(404).json({ error: "Vídeo não encontrado" })
    }

    if (!liker) {
      return res.status(400).json({ error: "Utilizador obrigatório" })
    }

    if (!await getUserByUsername(liker)) {
      return res.status(404).json({ error: "Utilizador não encontrado" })
    }

    const { error } = await supabase.from("video_likes").upsert([{ video_id: video.id, username: liker }], { onConflict: "video_id,username" })
    if (error) {
      throw error
    }

    return res.json(await decorateVideo(video, liker))
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao curtir" })
  }
})

app.post("/comment", async (req, res) => {
  try {
    const { id, user, author, comment } = req.body
    const text = String(comment || "").trim()

    const { data: video } = await supabase.from("videos").select("*").eq("id", Number(id)).maybeSingle()
    if (!video) {
      return res.status(404).json({ error: "Vídeo não encontrado" })
    }

    if (!text) {
      return res.status(400).json({ error: "Comentário vazio" })
    }

    const commentId = Date.now()
    const { error } = await supabase.from("comments").insert([{
      id: commentId,
      video_id: video.id,
      user_display: String(user || "Anónimo"),
      text,
      author_username: String(author || "").trim(),
      created_at: commentId
    }])

    if (error) {
      throw error
    }

    return res.json(await decorateVideo(video, String(author || "")))
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao comentar" })
  }
})

app.post("/comment/delete", async (req, res) => {
  try {
    const { id, commentId, user } = req.body
    const username = String(user || "")

    const { data: video } = await supabase.from("videos").select("*").eq("id", Number(id)).maybeSingle()
    if (!video) {
      return res.status(404).json({ error: "Vídeo não encontrado" })
    }

    if (!username) {
      return res.status(400).json({ error: "Utilizador obrigatório" })
    }

    const { data: comment } = await supabase
      .from("comments")
      .select("*")
      .eq("id", Number(commentId))
      .eq("video_id", video.id)
      .maybeSingle()

    if (!comment) {
      return res.status(404).json({ error: "Comentário não encontrado" })
    }

    const canDelete = video.user_username === username || comment.author_username === username || comment.user_display === username
    if (!canDelete) {
      return res.status(403).json({ error: "Sem permissão para apagar comentário" })
    }

    const { error } = await supabase.from("comments").delete().eq("id", comment.id)
    if (error) {
      throw error
    }

    return res.json(await decorateVideo(video, username))
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao apagar comentário" })
  }
})

app.post("/follow", async (req, res) => {
  try {
    const follower = String(req.body.follower || "").trim()
    const following = String(req.body.following || "").trim()

    if (!follower || !following) {
      return res.status(400).json({ error: "Follow inválido" })
    }

    if (follower === following) {
      return res.status(400).json({ error: "Não podes seguir a tua própria conta" })
    }

    if (!await getUserByUsername(follower) || !await getUserByUsername(following)) {
      return res.status(404).json({ error: "Utilizador não encontrado" })
    }

    const { error } = await supabase.from("follows").upsert([{ follower, following }], { onConflict: "follower,following" })
    if (error) {
      throw error
    }

    return res.json({ ok: true })
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao seguir" })
  }
})

app.post("/unfollow", async (req, res) => {
  try {
    const follower = String(req.body.follower || "").trim()
    const following = String(req.body.following || "").trim()

    if (!follower || !following) {
      return res.status(400).json({ error: "Unfollow inválido" })
    }

    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("follower", follower)
      .eq("following", following)

    if (error) {
      throw error
    }

    return res.json({ ok: true })
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao deixar de seguir" })
  }
})

app.get("/following/:user", async (req, res) => {
  try {
    const user = String(req.params.user || "")
    const { data: followRows, error: followError } = await supabase
      .from("follows")
      .select("following")
      .eq("follower", user)

    if (followError) {
      throw followError
    }

    const following = (followRows || []).map(row => row.following)
    if (!following.length) {
      return res.json([])
    }

    const { data: videos, error: videosError } = await supabase
      .from("videos")
      .select("*")
      .in("user_username", following)
      .order("id", { ascending: false })

    if (videosError) {
      throw videosError
    }

    const decorated = await Promise.all((videos || []).map(video => decorateVideo(video, user)))
    return res.json(decorated)
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao carregar seguidos" })
  }
})

app.get("/profile/:username", async (req, res) => {
  try {
    const username = String(req.params.username || "").trim()
    const user = await getUserByUsername(username)

    if (!user) {
      return res.status(404).json({ error: "Perfil não encontrado" })
    }

    const [{ data: videos }, { count: followers }, { count: following }] = await Promise.all([
      supabase.from("videos").select("*").eq("user_username", user.username).order("id", { ascending: false }),
      supabase.from("follows").select("follower", { count: "exact", head: true }).eq("following", user.username),
      supabase.from("follows").select("following", { count: "exact", head: true }).eq("follower", user.username)
    ])

    const decoratedVideos = await Promise.all((videos || []).map(video => decorateVideo(video, user.username)))

    return res.json({
      user: normalizeUserRow(user),
      videos: decoratedVideos,
      followers: followers || 0,
      following: following || 0
    })
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao carregar perfil" })
  }
})

app.post("/profile/update", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim()
    const displayName = String(req.body.displayName || "").trim()
    const avatar = String(req.body.avatar || "")

    const user = await getUserByUsername(username)
    if (!user) {
      return res.status(404).json({ error: "Perfil não encontrado" })
    }

    if (!displayName) {
      return res.status(400).json({ error: "Nome do canal obrigatório" })
    }

    const { error } = await supabase
      .from("users")
      .update({ display_name: displayName, avatar })
      .eq("username", username)

    if (error) {
      throw error
    }

    const updated = await getUserByUsername(username)
    return res.json(normalizeUserRow(updated))
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao atualizar perfil" })
  }
})

app.get("/health", async (req, res) => {
  try {
    const { error } = await supabase.from("users").select("id", { head: true, count: "exact" })
    if (error) {
      return res.status(500).json({ ok: false, database: "supabase", error: error.message })
    }

    return res.json({ ok: true, database: "supabase", cloudinary: cloudinaryReady })
  } catch (error) {
    return res.status(500).json({ ok: false, database: "supabase", error: error.message })
  }
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

async function start() {
  try {
    await migrateFromLegacyJsonIfNeeded()
    app.listen(PORT, () => {
      console.log(`ScootTok running 🛴 on port ${PORT} (supabase mode)`)
    })
  } catch (error) {
    console.error("Falha ao iniciar modo Supabase:", error)
    process.exit(1)
  }
}

start()
