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

	profileTitle.textContent = isOwnProfile ? "O teu perfil" : `Perfil de ${userData.displayName}`
	document.getElementById("profileDisplayName").textContent = userData.displayName
	document.getElementById("profileUsername").textContent = `@${userData.username}`
	profileFollowers.textContent = `${followers || 0} seguidores · ${following || 0} a seguir`
	profileHint.textContent = isOwnProfile
		? "Aqui aparecem todos os teus vídeos, views únicas e corações."
		: "Aqui aparecem os vídeos deste canal, views únicas e corações."
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
	uploadCard.scrollIntoView({ behavior: "smooth", block: "start" })
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
	const response = await fetch(url, options)
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
	const videoFile = document.getElementById("video").files[0]
	const thumbnailFile = document.getElementById("thumbnail").files[0]
	const title = document.getElementById("title").value.trim()
	const desc = document.getElementById("desc").value.trim()

	if (!videoFile) {
		alert("Escolhe um vídeo")
		return
	}

	if (!title) {
		alert("Título obrigatório")
		return
	}

	const form = new FormData()
	form.append("video", videoFile)
	if (thumbnailFile) form.append("thumbnail", thumbnailFile)
	form.append("user", currentUser.username)
	form.append("title", title)
	form.append("desc", desc)

	try {
		await api("/upload", {
			method: "POST",
			body: form
		})

		document.getElementById("title").value = ""
		document.getElementById("desc").value = ""
		document.getElementById("video").value = ""
		document.getElementById("thumbnail").value = ""
		loadVideos()
		showFeedView()
	} catch (error) {
		alert(error.message)
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
					${canDeleteComment(videoData, comment) ? `<button class="danger" onclick="deleteComment(${videoData.id}, ${comment.id})">Apagar</button>` : ""}
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
					src="/media/${videoData.id}"
					${videoData.thumbnail ? `poster="/thumbnail/${videoData.id}"` : ""}
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
	toggleLike(id)
}

function renderVideoList(container, videos, options = {}) {
	if (!videos.length) {
		container.innerHTML = `<p class="muted" style="padding:20px">Ainda não há vídeos aqui.</p>`
		return
	}

	container.innerHTML = videos.map(videoData => renderVideoCard(videoData, options)).join("")
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
		const data = await api(`/profile/${encodeURIComponent(username)}`)
		renderProfileHeader(data.user, data.followers, data.following)
		renderVideoList(profileVideos, data.videos, { profile: true })
	} catch (error) {
		alert(error.message)
	}
}

async function toggleLike(id) {
	if (!currentUser) return
	try {
		const videoData = await api("/like", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ id, user: currentUser.username })
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

document.addEventListener("click", event => {
	if (!event.target.closest(".menu-area")) {
		closeMenu()
	}

	if (event.target === customizeModal) {
		closeCustomizeModal()
	}
})

window.addEventListener("load", () => {
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