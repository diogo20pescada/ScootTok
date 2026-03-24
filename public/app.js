let currentUser = null
let currentProfileUsername = null
let currentFeedMode = "explore"
let currentSearchQuery = ""
const viewedVideos = new Set()
let soundEnabled = localStorage.getItem("scoottokSound") === "1"
let searchDebounceTimer = null

const loginScreen = document.getElementById("login")
const appScreen = document.getElementById("app")
const feed = document.getElementById("feed")
const profileVideos = document.getElementById("profileVideos")
const sectionTitle = document.getElementById("sectionTitle")
const welcomeText = document.getElementById("welcomeText")
const profileTitle = document.getElementById("profileTitle")
const profileFollowers = document.getElementById("profileFollowers")
const profileHint = document.getElementById("profileHint")
const feedSection = document.getElementById("feedSection")
const profileSection = document.getElementById("profileSection")
const menuDropdown = document.getElementById("menuDropdown")
const customizeModal = document.getElementById("customizeModal")
const uploadCard = document.getElementById("uploadCard")
const uploadFab = document.getElementById("uploadFab")
const searchWrap = document.getElementById("searchWrap")
const searchInput = document.getElementById("searchInput")
const searchPreviewModal = document.getElementById("searchPreviewModal")
const searchPreviewVideo = document.getElementById("searchPreviewVideo")
const searchPreviewTitle = document.getElementById("searchPreviewTitle")
const videoEditModal = document.getElementById("videoEditModal")
const videoEditTitleInput = document.getElementById("videoEditTitleInput")
const videoEditDescInput = document.getElementById("videoEditDescInput")
const videoEditThumbnailInput = document.getElementById("videoEditThumbnailInput")
const uploadButton = document.getElementById("uploadButton")
const uploadPrevButton = document.getElementById("uploadPrevButton")
const uploadNextButton = document.getElementById("uploadNextButton")
const uploadAnalysisStatus = document.getElementById("uploadAnalysisStatus")
const API_BASE_URL = String(window.SCOOTTOK_API_BASE_URL || "").trim().replace(/\/$/, "")
let editingVideoId = null
let currentUploadStep = 1

function toAppUrl(pathname) {
	if (!pathname.startsWith("/")) {
		return pathname
	}

	return API_BASE_URL ? `${API_BASE_URL}${pathname}` : pathname
}

function escapeHtml(text) {
	return String(text || "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
}

function getAvatarMarkup(user, className = "tiny-avatar") {
	if (user?.avatar) {
		return `<img class="${className}" src="${user.avatar}" alt="Foto de perfil">`
	}

	return `<span class="${className}">👤</span>`
}

function updateAvatar(imgId, fallbackId, avatar) {
	const image = document.getElementById(imgId)
	const fallback = document.getElementById(fallbackId)

	if (!image || !fallback) {
		return
	}

	if (avatar) {
		image.src = avatar
		image.classList.remove("hidden")
		fallback.classList.add("hidden")
	} else {
		image.removeAttribute("src")
		image.classList.add("hidden")
		fallback.classList.remove("hidden")
	}
}

function setCurrentUser(userData) {
	currentUser = userData
	localStorage.setItem("scoottokUser", JSON.stringify(userData))
	welcomeText.textContent = `Canal: ${userData.displayName}`
	document.getElementById("displayNameInput").value = userData.displayName
	updateAvatar("profileAvatarSmall", "profileAvatarFallbackSmall", userData.avatar)
}

function showApp() {
	loginScreen.classList.add("hidden")
	appScreen.classList.remove("hidden")
}

function showLogin() {
	loginScreen.classList.remove("hidden")
	appScreen.classList.add("hidden")
}

function setActiveTab(mode) {
	currentFeedMode = mode
	document.getElementById("exploreBtn").classList.toggle("active", mode === "explore")
	document.getElementById("followingBtn").classList.toggle("active", mode === "following")
}

function toggleMenu() {
	menuDropdown.classList.toggle("hidden")
}

function closeMenu() {
	menuDropdown.classList.add("hidden")
}

function openCustomizeModal() {
	closeMenu()
	if (!currentUser) {
		return
	}

	document.getElementById("displayNameInput").value = currentUser.displayName || currentUser.username
	document.getElementById("avatarInput").value = ""
	customizeModal.classList.remove("hidden")
}

function closeCustomizeModal() {
	customizeModal.classList.add("hidden")
}

function showFeedView() {
	uploadCard.classList.add("hidden")
	profileSection.classList.add("hidden")
	feedSection.classList.remove("hidden")
	uploadFab.classList.remove("hidden")
}

function openProfileView() {
	openUserProfile(currentUser.username)
}

function handleProfileAvatarClick() {
	if (!currentUser || currentProfileUsername !== currentUser.username) {
		return
	}

	openCustomizeModal()
}

function renderProfileHeader(userData, followers, following) {
	const isOwnProfile = userData.username === currentUser.username
	const loginCount = Number(userData.loginCount) || 0

	profileTitle.textContent = isOwnProfile ? "O teu perfil" : `Perfil de ${userData.displayName}`
	document.getElementById("profileDisplayName").textContent = userData.displayName
	document.getElementById("profileUsername").textContent = `@${userData.username}`
	profileFollowers.textContent = `${followers || 0} seguidores · ${following || 0} a seguir · ${loginCount} logins`
	profileHint.textContent = isOwnProfile
		? "Aqui aparecem todos os teus vídeos, views únicas, corações e total de logins."
		: "Aqui aparecem os vídeos deste canal, views únicas, corações e total de logins."
	updateAvatar("profileAvatarLarge", "profileAvatarFallbackLarge", userData.avatar)
}

async function openUserProfile(username) {
	if (!currentUser) {
		return
	}

	uploadCard.classList.add("hidden")
	feedSection.classList.add("hidden")
	profileSection.classList.remove("hidden")
	uploadFab.classList.add("hidden")
	await loadProfile(username)
}

function openUploadView() {
	profileSection.classList.add("hidden")
	feedSection.classList.add("hidden")
	uploadCard.classList.remove("hidden")
	uploadFab.classList.add("hidden")
	setUploadStep(1)
	uploadCard.scrollIntoView({ behavior: "smooth", block: "start" })
}

function validateUploadStep(step) {
	if (step === 1) {
		const videoFile = document.getElementById("video").files[0]
		if (!videoFile) {
			alert("Escolhe um vídeo")
			return false
		}
	}

	if (step === 2) {
		const title = document.getElementById("title").value.trim()
		if (!title) {
			alert("Título obrigatório")
			return false
		}
	}

	if (step === 3) {
		const musicLicense = document.getElementById("musicLicense").value
		const imageLicense = document.getElementById("imageLicense").value
		const musicLicenseProof = document.getElementById("musicLicenseProof").value.trim()
		const imageLicenseProof = document.getElementById("imageLicenseProof").value.trim()
		const rightsDeclaration = Boolean(document.getElementById("rightsDeclaration")?.checked)

		if (!musicLicense) {
			alert("Seleciona os direitos da música")
			return false
		}

		if (!imageLicense) {
			alert("Seleciona os direitos da imagem/capa")
			return false
		}

		if ((musicLicense === "creative-commons" || musicLicense === "licensed") && !musicLicenseProof) {
			alert("Adiciona prova de licença da música")
			return false
		}

		if ((imageLicense === "creative-commons" || imageLicense === "licensed") && !imageLicenseProof) {
			alert("Adiciona prova de licença da imagem/capa")
			return false
		}

		if (!rightsDeclaration) {
			alert("Tens de confirmar a declaração de direitos")
			return false
		}
	}

	return true
}

function setUploadStep(step) {
	currentUploadStep = Math.max(1, Math.min(3, Number(step) || 1))
	document.querySelectorAll("[data-upload-step]").forEach(section => {
		const sectionStep = Number(section.getAttribute("data-upload-step"))
		section.classList.toggle("hidden", sectionStep !== currentUploadStep)
	})

	document.querySelectorAll("[data-step-chip]").forEach(chip => {
		const chipStep = Number(chip.getAttribute("data-step-chip"))
		chip.classList.toggle("active", chipStep === currentUploadStep)
	})

	uploadPrevButton?.classList.toggle("hidden", currentUploadStep === 1)
	uploadNextButton?.classList.toggle("hidden", currentUploadStep === 3)
	uploadButton?.classList.toggle("hidden", currentUploadStep !== 3)
}

function nextUploadStep() {
	if (!validateUploadStep(currentUploadStep)) {
		return
	}

	setUploadStep(currentUploadStep + 1)
}

function previousUploadStep() {
	setUploadStep(currentUploadStep - 1)
}

function fileToBase64(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(reader.result)
		reader.onerror = reject
		reader.readAsDataURL(file)
	})
}

async function api(url, options = {}) {
	const response = await fetch(toAppUrl(url), options)
	const isJson = response.headers.get("content-type")?.includes("application/json")
	const data = isJson ? await response.json() : await response.text()

	if (!response.ok) {
		throw new Error(data?.error || data || "Erro no pedido")
	}

	return data
}

async function register() {
	const username = user.value.trim()
	const password = pass.value.trim()

	try {
		await api("/register", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username, password })
		})

		alert("Conta criada. Agora faz login.")
	} catch (error) {
		alert(error.message)
	}
}

async function login() {
	const username = user.value.trim()
	const password = pass.value.trim()

	try {
		const userData = await api("/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username, password })
		})

		setCurrentUser(userData)
		showApp()
		showFeedView()
		loadVideos()
	} catch (error) {
		alert(error.message)
	}
}

function logout() {
	closeMenu()
	uploadCard.classList.add("hidden")
	currentProfileUsername = null
	currentUser = null
	currentSearchQuery = ""
	if (searchInput) {
		searchInput.value = ""
	}
	searchWrap?.classList.remove("open")
	viewedVideos.clear()
	localStorage.removeItem("scoottokUser")
	showLogin()
}

function reloadCurrentFeed() {
	if (currentFeedMode === "following") {
		loadFollowing()
		return
	}

	loadVideos()
}

function applySearch() {
	if (!searchInput) {
		return
	}

	const nextQuery = searchInput.value.trim()
	if (nextQuery === currentSearchQuery) {
		return
	}

	currentSearchQuery = nextQuery
	reloadCurrentFeed()
}

function toggleSearch() {
	if (!searchWrap || !searchInput) {
		return
	}

	const opening = !searchWrap.classList.contains("open")
	searchWrap.classList.toggle("open", opening)

	if (opening) {
		searchInput.focus()
		return
	}

	if (!searchInput.value.trim() && currentSearchQuery) {
		currentSearchQuery = ""
		reloadCurrentFeed()
	}
}

function clearSearch() {
	if (!searchInput) {
		return
	}

	searchInput.value = ""
	if (!currentSearchQuery) {
		searchInput.focus()
		return
	}

	currentSearchQuery = ""
	reloadCurrentFeed()
	searchInput.focus()
}

function handleSearchKeydown(event) {
	if (event.key === "Enter") {
		event.preventDefault()
		applySearch()
	}
}

function handleSearchInput() {
	if (!searchInput) {
		return
	}

	const value = searchInput.value.trim()
	clearTimeout(searchDebounceTimer)

	if (!value && currentSearchQuery) {
		currentSearchQuery = ""
		reloadCurrentFeed()
		return
	}

	searchDebounceTimer = setTimeout(() => {
		applySearch()
	}, 240)
}

async function upload() {
	if (!validateUploadStep(3)) {
		return
	}

	const videoFile = document.getElementById("video").files[0]
	const thumbnailFile = document.getElementById("thumbnail").files[0]
	const title = document.getElementById("title").value.trim()
	const desc = document.getElementById("desc").value.trim()
	const musicLicense = document.getElementById("musicLicense").value
	const imageLicense = document.getElementById("imageLicense").value
	const musicLicenseProof = document.getElementById("musicLicenseProof").value.trim()
	const imageLicenseProof = document.getElementById("imageLicenseProof").value.trim()
	const rightsDeclaration = Boolean(document.getElementById("rightsDeclaration")?.checked)

	const form = new FormData()
	form.append("video", videoFile)
	if (thumbnailFile) form.append("thumbnail", thumbnailFile)
	form.append("user", currentUser.username)
	form.append("title", title)
	form.append("desc", desc)
	form.append("musicLicense", musicLicense)
	form.append("imageLicense", imageLicense)
	form.append("musicLicenseProof", musicLicenseProof)
	form.append("imageLicenseProof", imageLicenseProof)
	form.append("rightsDeclaration", rightsDeclaration ? "1" : "0")

	if (uploadButton) {
		uploadButton.disabled = true
		uploadButton.textContent = "A analisar..."
	}

	if (uploadAnalysisStatus) {
		uploadAnalysisStatus.textContent = "Analisando com IA de segurança e direitos autorais..."
	}

	try {
		const uploadResult = await api("/upload", {
			method: "POST",
			body: form
		})

		document.getElementById("title").value = ""
		document.getElementById("desc").value = ""
		document.getElementById("video").value = ""
		document.getElementById("thumbnail").value = ""
		document.getElementById("musicLicense").value = ""
		document.getElementById("imageLicense").value = ""
		document.getElementById("musicLicenseProof").value = ""
		document.getElementById("imageLicenseProof").value = ""
		document.getElementById("rightsDeclaration").checked = false
		setUploadStep(1)
		if (uploadResult?.pendingModeration) {
			alert(uploadResult.moderationMessage || "Vídeo enviado para moderação antes de aparecer no feed.")
		}

		if (uploadAnalysisStatus) {
			const analysisMessage = uploadResult?.analysis?.summary || uploadResult?.moderationMessage || "Análise concluída."
			uploadAnalysisStatus.textContent = analysisMessage
		}

		loadVideos()
		showFeedView()
	} catch (error) {
		if (uploadAnalysisStatus) {
			uploadAnalysisStatus.textContent = `Falhou na análise: ${error.message}`
		}
		alert(error.message)
	} finally {
		if (uploadButton) {
			uploadButton.disabled = false
			uploadButton.textContent = "Postar vídeo"
		}
	}
}

function canDeleteComment(videoData, comment) {
	if (!currentUser) {
		return false
	}

	return videoData.user === currentUser.username || comment.author === currentUser.username || comment.user === currentUser.username
}

function renderComments(videoData) {
	if (!videoData.comments?.length) {
		return `<div class="comment-item muted">Ainda sem comentários.</div>`
	}

	return videoData.comments
		.map(comment => `
			<div class="comment-item">
				<div class="comment-head">
					<strong>${escapeHtml(comment.user)}</strong>
					${canDeleteComment(videoData, comment) ? `<button class="danger" onclick="deleteComment(${videoData.id}, ${JSON.stringify(String(comment.id ?? ""))})">Apagar</button>` : ""}
				</div>
				<p>${escapeHtml(comment.text)}</p>
			</div>
		`)
		.join("")
}

function renderVideoCard(videoData, options = {}) {
	const showFollow = !options.profile && videoData.user !== currentUser.username
	const isFollowing = Boolean(videoData.followed)
	const targetUser = encodeURIComponent(videoData.user)
	const liked = Boolean(videoData.liked)
	const isProfile = Boolean(options.profile)
	const canEditVideo = isProfile && currentProfileUsername === currentUser.username && videoData.user === currentUser.username
	const encodedVideoTitle = encodeURIComponent(String(videoData.title || ""))
	const encodedVideoDesc = encodeURIComponent(String(videoData.desc || ""))
	const dblClickAttr = isProfile ? "" : `ondblclick="handleVideoDoubleClick(event, ${videoData.id})"`
	const videoAttrs = isProfile
		? `controls controlsList="nodownload noplaybackrate" disablePictureInPicture`
		: "playsinline"
	const soundIcon = soundEnabled ? "🔊" : "🔇"
	const soundLabel = soundEnabled ? "Desativar som" : "Ativar som"

	return `
		<article
			class="video${isProfile ? " video-card-mode" : ""}"
			id="video-card-${videoData.id}"
			${dblClickAttr}
		>
			<div class="video-wrapper">
				<video
					src="${toAppUrl(`/media/${videoData.id}`)}"
					${videoData.thumbnail ? `poster="${toAppUrl(`/thumbnail/${videoData.id}`)}"` : ""}
					${soundEnabled ? "" : "muted"}
					loop
					${videoAttrs}
					onplay="markView(${videoData.id}, this)"
				></video>
			</div>

			<div class="video-scrim"></div>

			<div class="video-overlay">
				<div class="overlay-left">
					<div class="overlay-creator">
						<button class="owner-avatar-btn" onclick="openUserProfile('${targetUser}')" aria-label="Perfil">
							${getAvatarMarkup(videoData.owner, "creator-avatar")}
						</button>
						<div class="creator-info">
							<span class="creator-name">${escapeHtml(videoData.owner?.displayName || videoData.user)}</span>
							${showFollow ? `<button class="follow-pill${isFollowing ? " following" : ""}" data-following="${isFollowing ? "1" : "0"}" data-target-user="${targetUser}" onclick="toggleFollow('${targetUser}', this)">${isFollowing ? "A seguir" : "Seguir"}</button>` : ""}
						</div>
					</div>
					<h3 class="overlay-title">${escapeHtml(videoData.title)}</h3>
					${videoData.desc ? `<p class="overlay-desc">${escapeHtml(videoData.desc)}</p>` : ""}
				</div>

				<div class="overlay-right">
					<div class="action-btn">
						<button class="action-icon-btn" onclick="toggleSound()" aria-label="${soundLabel}" title="${soundLabel}" id="sound-btn-${videoData.id}">${soundIcon}</button>
					</div>

					${canEditVideo ? `
						<div class="action-btn">
							<button class="action-icon-btn video-options-btn" onclick="openVideoEditModal(${videoData.id}, '${encodedVideoTitle}', '${encodedVideoDesc}')" aria-label="Editar vídeo" title="Editar vídeo">⋯</button>
						</div>
					` : ""}

					<div class="action-btn">
						<button
							class="heart-overlay${liked ? " liked" : ""}"
							id="heart-${videoData.id}"
							data-liked="${liked ? "1" : "0"}"
							ondblclick="event.stopPropagation()"
							onclick="toggleLike(${videoData.id})"
							aria-label="Curtir"
						>${liked ? "❤️" : "🤍"}</button>
						<span class="action-count" id="likes-${videoData.id}">${videoData.likes || 0}</span>
					</div>

					<div class="action-btn">
						<button class="action-icon-btn" onclick="toggleComments(${videoData.id})" aria-label="Comentários">💬</button>
						<span class="action-count">${(videoData.comments || []).length}</span>
					</div>

					<div class="action-btn">
						<div class="stat-icon-btn">👁️</div>
						<span class="action-count" id="views-${videoData.id}">${videoData.views || 0}</span>
					</div>
				</div>
			</div>

			<div id="comments-panel-${videoData.id}" class="comments-panel hidden">
				<div class="comments-panel-header">
					<span>Comentários (${(videoData.comments || []).length})</span>
					<button class="ghost icon-btn" onclick="toggleComments(${videoData.id})">✕</button>
				</div>
				<div id="comments-${videoData.id}" class="comments-scroll">
					${renderComments(videoData)}
				</div>
				<div class="comment-row">
					<input id="c${videoData.id}" placeholder="Adicionar comentário...">
					<button onclick="comment(${videoData.id})">Enviar</button>
				</div>
			</div>
		</article>
	`
}

function renderSearchResultCard(videoData) {
	const ownerName = escapeHtml(videoData.owner?.displayName || videoData.user)
	const title = escapeHtml(videoData.title || "Sem título")
	const thumb = videoData.thumbnail
		? `<img class="search-thumb" src="${toAppUrl(`/thumbnail/${videoData.id}`)}" alt="Capa de ${title}">`
		: `<div class="search-thumb-fallback">Sem capa</div>`

	return `
		<article class="search-card" onclick="openSearchFeed(${videoData.id})">
			${thumb}
			<div class="search-card-meta">
				<div class="search-card-title">${title}</div>
				<div class="search-card-info">${ownerName} · 👁️ ${videoData.views || 0}</div>
			</div>
		</article>
	`
}

function getSearchTokens(videoData) {
	return `${videoData.title || ""} ${videoData.desc || ""}`
		.toLowerCase()
		.split(/[^a-z0-9à-ÿ]+/i)
		.filter(token => token.length > 2)
}

function rankRelatedVideos(selectedVideo, videos) {
	const selectedTokens = new Set(getSearchTokens(selectedVideo))

	return videos
		.filter(video => Number(video.id) !== Number(selectedVideo.id))
		.map(video => {
			const tokens = getSearchTokens(video)
			let sharedTokens = 0
			for (const token of tokens) {
				if (selectedTokens.has(token)) {
					sharedTokens += 1
				}
			}

			const sameOwnerBonus = video.user === selectedVideo.user ? 6 : 0
			const popularityBoost = Math.min(Number(video.views) || 0, 20) / 10
			const recencyBoost = (Number(video.createdAt) || Number(video.id) || 0) / 1e15
			const relevanceScore = (sharedTokens * 2) + sameOwnerBonus + popularityBoost + recencyBoost

			return { video, relevanceScore }
		})
		.sort((a, b) => b.relevanceScore - a.relevanceScore)
		.map(item => item.video)
}

async function openSearchFeed(id) {
	if (!currentUser) {
		return
	}

	try {
		const searchParam = currentSearchQuery ? `&q=${encodeURIComponent(currentSearchQuery)}` : ""
		const videos = await api(`/videos?viewer=${encodeURIComponent(currentUser.username)}${searchParam}`)
		const selectedVideo = videos.find(video => Number(video.id) === Number(id))

		if (!selectedVideo) {
			alert("Vídeo não encontrado nos resultados")
			return
		}

		const ordered = [selectedVideo, ...rankRelatedVideos(selectedVideo, videos)]
		setActiveTab("explore")
		sectionTitle.textContent = "Explorar"
		renderVideoList(feed, ordered, { searchAsFeed: true })
		showFeedView()
	} catch (error) {
		alert(error.message)
	}
}

function openSearchPreview(id, encodedTitle) {
	if (!searchPreviewModal || !searchPreviewVideo || !searchPreviewTitle) {
		return
	}

	const title = decodeURIComponent(encodedTitle || "")
	searchPreviewTitle.textContent = title || "Preview"
	searchPreviewVideo.src = toAppUrl(`/media/${id}`)
	searchPreviewModal.classList.remove("hidden")
	searchPreviewVideo.play().catch(() => {})
}

function closeSearchPreview() {
	if (!searchPreviewModal || !searchPreviewVideo) {
		return
	}

	searchPreviewVideo.pause()
	searchPreviewVideo.removeAttribute("src")
	searchPreviewVideo.load()
	searchPreviewModal.classList.add("hidden")
}

function openVideoEditModal(id, encodedTitle, encodedDesc) {
	if (!currentUser || currentProfileUsername !== currentUser.username || !videoEditModal) {
		return
	}

	editingVideoId = Number(id)
	videoEditTitleInput.value = decodeURIComponent(encodedTitle || "")
	videoEditDescInput.value = decodeURIComponent(encodedDesc || "")
	videoEditThumbnailInput.value = ""
	videoEditModal.classList.remove("hidden")
}

function closeVideoEditModal() {
	if (!videoEditModal) {
		return
	}

	editingVideoId = null
	videoEditModal.classList.add("hidden")
}

let videoObserver = null

function syncVideoSoundState() {
	document.querySelectorAll(".video-wrapper video").forEach(video => {
		video.muted = !soundEnabled
	})

	document.querySelectorAll("[id^='sound-btn-']").forEach(button => {
		button.textContent = soundEnabled ? "🔊" : "🔇"
		button.setAttribute("aria-label", soundEnabled ? "Desativar som" : "Ativar som")
		button.setAttribute("title", soundEnabled ? "Desativar som" : "Ativar som")
	})
}

function toggleSound() {
	soundEnabled = !soundEnabled
	localStorage.setItem("scoottokSound", soundEnabled ? "1" : "0")
	syncVideoSoundState()
}

function setupVideoAutoplay() {
	if (videoObserver) videoObserver.disconnect()
	videoObserver = new IntersectionObserver((entries) => {
		entries.forEach(entry => {
			if (entry.isIntersecting) {
				entry.target.play().catch(() => {})
			} else {
				entry.target.pause()
			}
		})
	}, { threshold: 0.5 })

	document.querySelectorAll(".video-wrapper video").forEach(video => {
		video.muted = !soundEnabled
		videoObserver.observe(video)
	})
}

function showLikeAnimation(wrapperEl) {
	const pop = document.createElement("div")
	pop.className = "heart-pop"
	pop.textContent = "❤️"
	wrapperEl.appendChild(pop)
	setTimeout(() => pop.remove(), 800)
}

function handleVideoDoubleClick(event, id) {
	if (!currentUser) return
	if (event.target.closest("button, input, .comments-panel")) return
	showLikeAnimation(event.currentTarget)
	toggleLike(id, { mode: "like" })
}

function renderVideoList(container, videos, options = {}) {
	if (!videos.length) {
		container.classList.remove("search-results-mode")
		container.innerHTML = `<p class="muted" style="padding:20px">Ainda não há vídeos aqui.</p>`
		return
	}

	const isSearchMode = Boolean(currentSearchQuery) && !options.profile && !options.searchAsFeed
	if (isSearchMode) {
		const ordered = [...videos].sort((a, b) => (b.views || 0) - (a.views || 0) || ((b.createdAt || b.id || 0) - (a.createdAt || a.id || 0)))
		container.classList.add("search-results-mode")
		container.innerHTML = ordered.map(videoData => renderSearchResultCard(videoData)).join("")
		container.scrollTo({ top: 0, behavior: "auto" })
		if (videoObserver) {
			videoObserver.disconnect()
		}
		return
	}

	container.classList.remove("search-results-mode")

	container.innerHTML = videos.map(videoData => renderVideoCard(videoData, options)).join("")
	container.scrollTo({ top: 0, behavior: "auto" })
	setupVideoAutoplay()
}

async function loadVideos() {
	try {
		setActiveTab("explore")
		sectionTitle.textContent = "Explorar"
		const searchParam = currentSearchQuery ? `&q=${encodeURIComponent(currentSearchQuery)}` : ""
		const videos = await api(`/videos?viewer=${encodeURIComponent(currentUser.username)}${searchParam}`)
		renderVideoList(feed, videos)
		showFeedView()
	} catch (error) {
		alert(error.message)
	}
}

async function loadFollowing() {
	try {
		setActiveTab("following")
		sectionTitle.textContent = "A seguir"
		const searchParam = currentSearchQuery ? `?q=${encodeURIComponent(currentSearchQuery)}` : ""
		const videos = await api(`/following/${encodeURIComponent(currentUser.username)}${searchParam}`)
		renderVideoList(feed, videos)
		showFeedView()
	} catch (error) {
		alert(error.message)
	}
}

async function loadProfile(username = currentUser.username) {
	try {
		currentProfileUsername = username
		const viewerParam = currentUser?.username ? `?viewer=${encodeURIComponent(currentUser.username)}` : ""
		const data = await api(`/profile/${encodeURIComponent(username)}${viewerParam}`)
		renderProfileHeader(data.user, data.followers, data.following)
		renderVideoList(profileVideos, data.videos, { profile: true })
	} catch (error) {
		alert(error.message)
	}
}

const likeRequestsInFlight = new Set()

async function toggleLike(id, options = {}) {
	if (!currentUser) return
	if (likeRequestsInFlight.has(id)) return

	const mode = options.mode === "like" ? "like" : "toggle"
	if (mode === "like") {
		const heartBtn = document.getElementById(`heart-${id}`)
		if (heartBtn?.dataset?.liked === "1") {
			return
		}
	}

	likeRequestsInFlight.add(id)
	try {
		const videoData = await api("/like", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ id, user: currentUser.username, mode })
		})

		const newLiked = Boolean(videoData.liked)
		document.getElementById(`likes-${id}`).textContent = `❤️ ${videoData.likes || 0}`

		const heartBtn = document.getElementById(`heart-${id}`)
		if (heartBtn) {
			heartBtn.textContent = newLiked ? "❤️" : "🤍"
			heartBtn.dataset.liked = newLiked ? "1" : "0"
			heartBtn.classList.toggle("liked", newLiked)
		}

		if (!profileSection.classList.contains("hidden")) {
			loadProfile(currentProfileUsername || currentUser.username)
		}
	} catch (error) {
		alert(error.message)
	} finally {
		likeRequestsInFlight.delete(id)
	}
}

async function markView(id) {
	if (!currentUser || viewedVideos.has(id)) {
		return
	}

	viewedVideos.add(id)

	try {
		const videoData = await api("/view", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ id, user: currentUser.username })
		})

		document.getElementById(`views-${id}`).textContent = `👁️ ${videoData.views || 0} views`

		if (!profileSection.classList.contains("hidden")) {
			loadProfile(currentProfileUsername || currentUser.username)
		}
	} catch (error) {
		console.error(error)
	}
}

function toggleComments(id) {
	document.getElementById(`comments-panel-${id}`)?.classList.toggle("hidden")
}

async function comment(id) {
	const input = document.getElementById(`c${id}`)
	const text = input.value.trim()

	if (!text) {
		alert("Escreve um comentário")
		return
	}

	try {
		const videoData = await api("/comment", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				id,
				user: currentUser.displayName,
				author: currentUser.username,
				comment: text
			})
		})

		document.getElementById(`comments-${id}`).innerHTML = renderComments(videoData)
		document.getElementById(`comments-panel-${id}`)?.classList.remove("hidden")
		input.value = ""
	} catch (error) {
		alert(error.message)
	}
}

async function deleteComment(id, commentId) {
	try {
		const videoData = await api("/comment/delete", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				id,
				commentId,
				user: currentUser.username
			})
		})

		document.getElementById(`comments-${id}`).innerHTML = renderComments(videoData)
		document.getElementById(`comments-panel-${id}`)?.classList.remove("hidden")

		if (!profileSection.classList.contains("hidden")) {
			loadProfile(currentProfileUsername || currentUser.username)
		}
	} catch (error) {
		alert(error.message)
	}
}

function updateFollowButtons(encodedTargetUser, isFollowing) {
	document.querySelectorAll(`[data-target-user="${encodedTargetUser}"]`).forEach(button => {
		button.dataset.following = isFollowing ? "1" : "0"
		button.textContent = isFollowing ? "A seguir" : "Seguir"
		button.classList.toggle("secondary", isFollowing)
	})
}

async function toggleFollow(encodedTargetUser, buttonElement) {
	const targetUser = decodeURIComponent(encodedTargetUser)
	const isFollowing = buttonElement?.dataset.following === "1"
	const endpoint = isFollowing ? "/unfollow" : "/follow"

	try {
		await api(endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				follower: currentUser.username,
				following: targetUser
			})
		})

		updateFollowButtons(encodedTargetUser, !isFollowing)

		if (currentFeedMode === "following") {
			loadFollowing()
		}
	} catch (error) {
		alert(error.message)
	}
}

async function saveProfile() {
	const displayName = document.getElementById("displayNameInput").value.trim()
	const avatarFile = document.getElementById("avatarInput").files[0]

	try {
		let avatar = currentUser.avatar || ""

		if (avatarFile) {
			avatar = await fileToBase64(avatarFile)
		}

		const updatedUser = await api("/profile/update", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				username: currentUser.username,
				displayName,
				avatar
			})
		})

		setCurrentUser(updatedUser)
		closeCustomizeModal()

		if (!profileSection.classList.contains("hidden")) {
			loadProfile(currentProfileUsername || currentUser.username)
		}
	} catch (error) {
		alert(error.message)
	}
}

async function saveVideoEdit() {
	if (!currentUser || !editingVideoId) {
		return
	}

	const title = videoEditTitleInput.value.trim()
	const desc = videoEditDescInput.value.trim()

	if (!title) {
		alert("Nome do vídeo obrigatório")
		return
	}

	try {
		let thumbnailData = ""
		const thumbnailFile = videoEditThumbnailInput.files[0]
		if (thumbnailFile) {
			thumbnailData = await fileToBase64(thumbnailFile)
		}

		await api("/video/update", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				id: editingVideoId,
				user: currentUser.username,
				title,
				desc,
				thumbnailData
			})
		})

		closeVideoEditModal()
		if (!profileSection.classList.contains("hidden")) {
			await loadProfile(currentProfileUsername || currentUser.username)
		} else {
			reloadCurrentFeed()
		}
	} catch (error) {
		alert(error.message)
	}
}

document.addEventListener("click", event => {
	if (!event.target.closest(".menu-area")) {
		closeMenu()
	}

	if (searchWrap && !event.target.closest("#searchWrap")) {
		searchWrap.classList.remove("open")
	}

	if (event.target === customizeModal) {
		closeCustomizeModal()
	}

	if (event.target === searchPreviewModal) {
		closeSearchPreview()
	}

	if (event.target === videoEditModal) {
		closeVideoEditModal()
	}
})

window.addEventListener("load", () => {
	if ("serviceWorker" in navigator) {
		navigator.serviceWorker.register("/sw.js").catch(error => {
			console.error("Service worker error", error)
		})
	}

	const savedUser = localStorage.getItem("scoottokUser")

	if (!savedUser) {
		return
	}

	try {
		setCurrentUser(JSON.parse(savedUser))
		showApp()
		loadVideos()
	} catch {
		localStorage.removeItem("scoottokUser")
	}
})