/**
 * Aegis Vision - Next-Gen CCTV Command Center Frontend Controller
 */

// Application State
const state = {
    cameras: [],
    currentLayout: localStorage.getItem('cctv_layout') || 'grid-2x2', // 'grid-1x1', 'grid-2x2', 'grid-3x2', 'grid-3x3', 'grid-focus'
    selectedCameraId: null,
    ptzActiveCamId: null,
    ptzSpeed: 0.5,
    soundEnabled: true,
    scanResults: [],
    isScanning: false,
    statsInterval: null,
    clockInterval: null,
    audioCtx: null,

    // Enterprise Features State
    isPatrolling: false,
    patrolTimer: null,
    patrolIndex: 0,
    patrolIntervalSec: 8,
    allGalleryItems: [],
    settings: {},
    enteredPin: '',
    pinPendingAction: null,
    storageStats: null,
    cameraMapCoords: {
        'cam-1': { x: 17, y: 76, zone: 'Zone 1: Main Entrance' },
        'cam-2': { x: 45, y: 55, zone: 'Zone 2: Corridor & Hall' },
        'cam-3': { x: 78, y: 30, zone: 'Zone 3: Backyard' },
        'cam-4': { x: 78, y: 76, zone: 'Zone 4: Driveway & Mikrotik' }
    },

    // New 6 Features State
    activeAudioCamId: null,
    audioMonitorNode: null,
    deferredPwaPrompt: null,
    currentMaskCamId: null,
    currentMasks: [],
    isDrawingMask: false,
    maskStartX: 0,
    maskStartY: 0,
    currentTempMask: null,
    knownFaces: [],
    selectedFaceBase64: null,
    selectedFaceCamId: null,
    selectedFaceUrl: null,
    armingStatus: { armed: true, mode: 'auto' },

    // YouTube Cinema Player State
    cinemaVideo: null,
    isCinemaScrubbing: false,
    isCinemaMiniPlayer: false,
    cinemaLastVolume: 1,
    cinemaControlsTimer: null,

    // Real Live RTSP Audio & DVR Red Seekbar State
    liveAudioCamId: null,
    dvrState: {},

    // RBAC & Authentication State
    currentUser: null,
    authToken: localStorage.getItem('cctv_auth_token') || '',
    allUsers: []
};

// Global Fetch Interceptor to automatically attach Auth Token & handle 401
const _originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
    options = options || {};
    options.headers = options.headers || {};
    if (state.authToken) {
        if (options.headers instanceof Headers) {
            options.headers.set('X-Auth-Token', state.authToken);
        } else if (Array.isArray(options.headers)) {
            options.headers.push(['X-Auth-Token', state.authToken]);
        } else {
            options.headers['X-Auth-Token'] = state.authToken;
        }
    }
    return _originalFetch(url, options).then(res => {
        if (res.status === 401 && typeof url === 'string' && !url.includes('/api/auth/')) {
            showLoginModal();
        }
        return res;
    });
};

// Web Audio API Beep Synthesizer for Alerts
function playAlertSound(type = 'motion') {
    if (!state.soundEnabled) return;
    try {
        if (!state.audioCtx) {
            state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (state.audioCtx.state === 'suspended') {
            state.audioCtx.resume();
        }
        const osc = state.audioCtx.createOscillator();
        const gain = state.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(state.audioCtx.destination);

        if (type === 'motion') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, state.audioCtx.currentTime); // A5
            osc.frequency.exponentialRampToValueAtTime(1320, state.audioCtx.currentTime + 0.15); // E6
            gain.gain.setValueAtTime(0.12, state.audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, state.audioCtx.currentTime + 0.25);
            osc.start();
            osc.stop(state.audioCtx.currentTime + 0.25);
        } else if (type === 'snap') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(1200, state.audioCtx.currentTime);
            gain.gain.setValueAtTime(0.1, state.audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, state.audioCtx.currentTime + 0.08);
            osc.start();
            osc.stop(state.audioCtx.currentTime + 0.08);
        }
    } catch (e) {
        console.warn('Audio alert error:', e);
    }
}

// Format Date / Time
function updateClock() {
    const now = new Date();
    const timeEl = document.getElementById('header-clock');
    const dateEl = document.getElementById('header-date');
    const mobileClockEl = document.getElementById('mobile-clock');
    const hrs = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const sec = String(now.getSeconds()).padStart(2, '0');
    const timeStr = `${hrs}<span class="animate-pulse">:</span>${min}<span class="animate-pulse">:</span>${sec}`;
    if (timeEl) timeEl.innerHTML = timeStr;
    if (mobileClockEl) mobileClockEl.innerHTML = timeStr;
    if (dateEl) {
        dateEl.textContent = now.toLocaleDateString('id-ID', {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
        });
    }
}

// Fetch Camera List & Render
async function fetchCameras() {
    try {
        const res = await fetch('/api/cameras');
        const data = await res.json();
        state.cameras = data.cameras || [];
        
        // Auto adapt layout if user only has 1 camera permitted
        if (state.currentUser && state.currentUser.role !== 'admin' && state.cameras.length === 1) {
            state.selectedCameraId = state.cameras[0].id;
            setLayout('grid-1x1');
        } else {
            setLayout(state.currentLayout);
        }

        renderCameraGrid();
        updateHeaderBadges();
    } catch (err) {
        console.error('Failed to fetch cameras:', err);
    }
}

// Update Top Bar Telemetry Badges
function updateHeaderBadges() {
    const onlineCount = state.cameras.filter(c => c.connected).length;
    const totalCount = state.cameras.length;
    
    const countBadge = document.getElementById('badge-online-count');
    if (countBadge) {
        countBadge.textContent = `${onlineCount}/${totalCount} ONLINE`;
    }

    // Sync mobile badge
    const mobileOnline = document.getElementById('mobile-badge-online');
    if (mobileOnline) {
        mobileOnline.textContent = `${onlineCount}/${totalCount} ONLINE`;
    }

    const motionBadge = document.getElementById('badge-motion-status');
    const mobileMotion = document.getElementById('mobile-badge-motion');
    const hasMotion = state.cameras.some(c => c.motion);
    if (motionBadge) {
        if (hasMotion) {
            motionBadge.className = 'px-2.5 py-1 text-xs rounded-full bg-red-500/20 text-red-400 border border-red-500/50 flex items-center gap-1.5 animate-pulse';
            motionBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500"></span> MOTION ALERT`;
        } else {
            motionBadge.className = 'px-2.5 py-1 text-xs rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5';
            motionBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span> AI MOTION READY`;
        }
    }
    if (mobileMotion) {
        if (hasMotion) {
            mobileMotion.className = 'font-mono text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/50 flex items-center gap-1 animate-pulse';
            mobileMotion.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-red-500"></span> ALERT`;
        } else {
            mobileMotion.className = 'font-mono text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1';
            mobileMotion.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> READY`;
        }
    }
}

// Render Video Grid without destroying live video elements
function renderCameraGrid() {
    const gridContainer = document.getElementById('camera-grid');
    if (!gridContainer) return;

    gridContainer.className = 'grid gap-4 transition-all duration-300 ' + getGridClass(state.currentLayout);

    if (state.cameras.length === 0) {
        const isAdmin = state.currentUser ? (state.currentUser.role === 'admin') : false;
        gridContainer.innerHTML = `
            <div class="col-span-full py-20 text-center glass-panel rounded-xl">
                <i data-lucide="video-off" class="w-16 h-16 text-slate-500 mx-auto mb-4"></i>
                <h3 class="text-xl font-tech text-slate-300 mb-2">Tidak Ada Kamera Tersedia</h3>
                <p class="text-slate-400 max-w-md mx-auto mb-6 text-sm">
                    ${isAdmin ? 'Gunakan tombol Scan ONVIF untuk mendeteksi kamera di jaringan lokal secara otomatis.' : 'Akun Anda belum memiliki kamera yang diizinkan atau sedang offline.'}
                </p>
                ${isAdmin ? `
                <button onclick="openScanModal()" class="px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold rounded-lg flex items-center gap-2 mx-auto">
                    <i data-lucide="radar" class="w-4 h-4"></i> Scan Jaringan ONVIF
                </button>
                ` : ''}
            </div>
        `;
        lucide.createIcons();
        return;
    }

    // Preserve existing live stream DOM elements to prevent socket drop / hanging
    state.cameras.forEach((cam, index) => {
        let card = document.getElementById(`card-${cam.id}`);
        if (!card || !document.getElementById(`dvr-track-${cam.id}`) || !document.getElementById(`zoom-container-${cam.id}`)) {
            const newCard = createCameraCard(cam, index);
            if (card) {
                card.replaceWith(newCard);
            } else {
                gridContainer.appendChild(newCard);
            }
            card = newCard;
            lucide.createIcons();
        }
        initCameraZoom(cam.id);
        applyLayoutToCard(card, index);
    });

    // Remove cards if deleted from backend
    const currentIds = new Set(state.cameras.map(c => `card-${c.id}`));
    Array.from(gridContainer.children).forEach(child => {
        if (child.id && !currentIds.has(child.id)) {
            child.remove();
        }
    });
}

function applyLayoutToCard(card, index) {
    if (!card) return;

    if (state.currentLayout === 'grid-1x1') {
        const activeId = state.selectedCameraId || (state.cameras[0] && state.cameras[0].id);
        if (card.id === `card-${activeId}`) {
            card.style.display = '';
            card.classList.remove('md:col-span-2', 'lg:col-span-3', 'row-span-2');
        } else {
            card.style.display = 'none';
        }
    } else {
        card.style.display = '';
        const isFocusMain = state.currentLayout === 'grid-focus' && index === 0;
        if (isFocusMain) {
            card.classList.add('md:col-span-2', 'lg:col-span-3', 'row-span-2');
        } else {
            card.classList.remove('md:col-span-2', 'lg:col-span-3', 'row-span-2');
        }
    }
}

function getGridClass(layout) {
    switch (layout) {
        case 'grid-1x1': return 'grid-cols-1';
        case 'grid-2x2': return 'grid-cols-1 md:grid-cols-2';
        case 'grid-3x2': return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
        case 'grid-3x3': return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
        case 'grid-focus': return 'grid-cols-1 md:grid-cols-3 lg:grid-cols-4';
        default: return 'grid-cols-1 md:grid-cols-2';
    }
}

// Generate Individual Camera Card DOM Element
function createCameraCard(cam, index) {
    const isFocusMain = state.currentLayout === 'grid-focus' && index === 0;
    const colSpan = isFocusMain ? 'md:col-span-2 lg:col-span-3 row-span-2' : '';

    const div = document.createElement('div');
    div.id = `card-${cam.id}`;
    div.className = `glass-panel rounded-xl overflow-hidden flex flex-col transition-all duration-300 relative group border ${
        cam.motion ? 'motion-alert-active' : 'border-slate-800 hover:border-cyan-500/40'
    } ${colSpan}`;

    const isAdmin = state.currentUser ? (state.currentUser.role === 'admin') : false;
    const perms = (state.currentUser && state.currentUser.permissions) || {};
    const canPTZ = isAdmin || !!perms.can_ptz;
    const canDVR = isAdmin || !!perms.can_dvr;
    const canSnapshot = isAdmin || !!perms.can_snapshot;
    const canRecord = isAdmin || !!perms.can_record;
    const canAudio = isAdmin || (perms.can_audio !== false);

    const tokenParam = state.authToken ? `?token=${encodeURIComponent(state.authToken)}` : '';
    const streamUrl = `/stream/${cam.id}${tokenParam}`;
    const statusDotClass = cam.connected ? 'bg-emerald-400 pulse-green' : 'bg-red-500 pulse-red';

    div.innerHTML = `
        <!-- Card Header (2-Tier Clean Professional Layout) -->
        <div class="cam-card-header px-3.5 py-2.5 bg-slate-900/95 border-b border-slate-800/90 flex flex-col gap-1.5 z-10">
            <!-- Row 1: Status Dot, Nama Kamera, Badge Gerakan, dan Tombol Suara -->
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0 flex-1">
                    <span class="w-2.5 h-2.5 rounded-full ${statusDotClass} shrink-0"></span>
                    <h4 class="font-tech font-bold text-sm text-slate-100 tracking-wide truncate cursor-pointer hover:text-cyan-300 transition" 
                        onclick="selectCameraForSingleView('${cam.id}')" title="Klik untuk fokus kamera: ${cam.name}">
                        ${cam.name}
                    </h4>
                    <span id="header-motion-${cam.id}" class="${cam.motion ? 'inline-flex' : 'hidden'} font-mono text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 items-center gap-1 shrink-0 animate-pulse" title="Terdeteksi Gerakan">
                        <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> GERAKAN
                    </span>
                </div>
                
                <!-- Live Microphone Audio Toggle (If Permitted) -->
                ${canAudio ? `
                <button onclick="toggleCameraAudioLive('${cam.id}')" id="card-audio-btn-${cam.id}" 
                        class="px-2.5 py-1 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition border shrink-0 ${
                            state.liveAudioCamId === cam.id ? 
                            'bg-cyan-500/25 text-cyan-300 border-cyan-400/60 shadow-lg shadow-cyan-500/20 animate-pulse' : 
                            'bg-slate-800/90 text-slate-400 hover:text-cyan-300 border-slate-700/80 hover:bg-slate-700'
                        }" title="Dengarkan Suara Langsung Mikrofon Kamera">
                    <i data-lucide="${state.liveAudioCamId === cam.id ? 'volume-2' : 'volume-x'}" class="w-3.5 h-3.5"></i>
                    <span id="card-audio-txt-${cam.id}">${state.liveAudioCamId === cam.id ? 'SUARA ON' : 'SUARA'}</span>
                </button>
                ` : ''}
            </div>

            <!-- Row 2: Alamat IP Kamera (Kiri) & Status Teknis (Ping, FPS, Resolusi) (Kanan) -->
            <div class="cam-card-meta flex items-center justify-between text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800/60">
                <!-- IP Address -->
                <span class="text-cyan-400/90 truncate flex items-center gap-1.5" title="Alamat IP Kamera">
                    <i data-lucide="radio" class="w-3 h-3 text-cyan-500/70 shrink-0"></i>
                    <span class="truncate">${cam.ip}${cam.onvif_port ? ':' + cam.onvif_port : ''}</span>
                </span>

                <!-- Technical Badges: Ping Latency, FPS, Resolution -->
                <div class="flex items-center gap-1.5 shrink-0">
                    <!-- Network Ping / Latency Badge -->
                    <span id="ping-${cam.id}" class="px-1.5 py-0.5 rounded bg-slate-800/90 text-cyan-300 border border-slate-700/70 flex items-center gap-1 text-[10px]" title="Ping & Kualitas Sinyal Jaringan">
                        <i data-lucide="wifi" class="w-3 h-3 text-cyan-400"></i>
                        <span id="ping-val-${cam.id}">${cam.ping_ms ? cam.ping_ms + 'ms' : '--ms'}</span>
                    </span>
                    <!-- FPS Counter -->
                    <span id="fps-${cam.id}" class="px-1.5 py-0.5 rounded bg-slate-800/90 text-emerald-400 border border-slate-700/70 text-[10px]">
                        ${cam.fps || 0} FPS
                    </span>
                    <!-- Resolution Tag -->
                    <span id="res-${cam.id}" class="px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-400 border border-slate-700/70 text-[10px] hidden sm:inline-block">
                        ${cam.resolution || '720p'}
                    </span>
                </div>
            </div>
        </div>

        <!-- Video Player Viewport with Real-Time Digital Zoom & Pan -->
        <div class="cam-card-viewport relative bg-black flex-1 min-h-[220px] aspect-video flex items-center justify-center overflow-hidden cursor-default select-none"
             id="viewport-${cam.id}">

            <!-- Hardware Accelerated Transform Container for Realtime Stream Scaling -->
            <div id="zoom-container-${cam.id}" class="cam-zoom-container w-full h-full flex items-center justify-center origin-center select-none" style="will-change: transform;">
                <img id="img-${cam.id}" 
                     src="${streamUrl}" 
                     alt="${cam.name}" 
                     class="w-full h-full object-contain pointer-events-none select-none"
                     onerror="handleStreamError('${cam.id}')" />

                <video id="dvr-video-${cam.id}" class="w-full h-full object-contain pointer-events-none hidden" playsinline></video>
            </div>

            <!-- Digital Zoom Badge Overlay (Shows magnification & reset on click) -->
            <div id="zoom-badge-${cam.id}" 
                 onclick="resetCameraZoom('${cam.id}')"
                 class="hidden absolute top-3 left-3 px-2 py-0.5 bg-cyan-950/85 hover:bg-cyan-900 border border-cyan-500/70 text-cyan-300 font-mono text-[11px] font-bold rounded shadow-lg backdrop-blur cursor-pointer z-10 items-center gap-1.5 transition select-none" 
                 title="Klik atau Double-Click untuk Reset Zoom">
                <i data-lucide="zoom-in" class="w-3.5 h-3.5 text-cyan-400"></i>
                <span id="zoom-val-${cam.id}">1.0x</span>
                <span class="text-[9px] text-cyan-400/80 bg-cyan-500/20 px-1 py-0.2 rounded hover:text-white">RESET</span>
            </div>

            <!-- Recording Indicator Overlay -->
            <div id="rec-banner-${cam.id}" class="${cam.is_recording ? 'flex' : 'hidden'} absolute top-3 right-3 px-2.5 py-1 bg-red-600/80 text-white font-mono font-bold text-xs rounded items-center gap-1.5 z-10 pointer-events-none">
                <span class="w-2 h-2 rounded-full bg-white animate-ping"></span> REC
            </div>

            <!-- Quick Action Toolbar on Hover -->
            <div class="cam-card-hover-toolbar absolute bottom-2 inset-x-2 p-1.5 bg-slate-950/80 backdrop-blur-md rounded-lg border border-slate-700/70 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                <div class="flex items-center gap-1">
                    ${canSnapshot ? `
                    <button onclick="takeSnapshot('${cam.id}')" title="Ambil Foto Snapshot" class="p-1.5 hover:bg-cyan-500/20 text-cyan-400 rounded transition">
                        <i data-lucide="camera" class="w-4 h-4"></i>
                    </button>
                    ` : ''}
                    ${canRecord ? `
                    <button onclick="toggleRecord('${cam.id}')" id="rec-btn-${cam.id}" title="Rekam Video Clip" class="p-1.5 ${cam.is_recording ? 'bg-red-500/30 text-red-400' : 'hover:bg-red-500/20 text-slate-300'} rounded transition">
                        <i data-lucide="circle-dot" class="w-4 h-4"></i>
                    </button>
                    ` : ''}
                    ${(cam.has_ptz && canPTZ) ? `
                    <button onclick="openPTZModal('${cam.id}', '${cam.name}', '${cam.ip}')" title="Kontrol PTZ (Putar Kamera)" class="p-1.5 hover:bg-cyan-500/20 text-cyan-400 rounded transition">
                        <i data-lucide="move" class="w-4 h-4"></i>
                    </button>
                    ` : ''}
                    ${isAdmin ? `
                    <!-- Privacy Masking Button (Feature 4) -->
                    <button onclick="openMaskModal('${cam.id}', '${cam.name}')" title="Sensor & Privacy Masking" class="p-1.5 hover:bg-amber-500/20 text-slate-400 hover:text-amber-400 rounded transition">
                        <i data-lucide="eye-off" class="w-4 h-4"></i>
                    </button>
                    <div class="relative inline-block">
                        <select onchange="changeFilter('${cam.id}', this.value)" class="bg-slate-800 text-slate-200 text-xs rounded px-1.5 py-1 border border-slate-700 outline-none">
                            <option value="normal" ${cam.filter === 'normal' ? 'selected' : ''}>Filter: Normal</option>
                            <option value="night" ${cam.filter === 'night' ? 'selected' : ''}>Night Vision</option>
                            <option value="thermal" ${cam.filter === 'thermal' ? 'selected' : ''}>Thermal</option>
                            <option value="bw" ${cam.filter === 'bw' ? 'selected' : ''}>Black & White</option>
                        </select>
                    </div>
                    ` : ''}
                </div>

                <div class="flex items-center gap-1">
                    <button onclick="handleQuickZoomBtn('${cam.id}')" title="Zoom In / Reset (Atau Scroll Mouse Pada Video)" class="p-1.5 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 rounded transition">
                        <i data-lucide="zoom-in" class="w-4 h-4"></i>
                    </button>
                    <button onclick="reloadStream('${cam.id}')" title="Segarkan Video Stream" class="p-1.5 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 rounded transition">
                        <i data-lucide="rotate-cw" class="w-4 h-4"></i>
                    </button>
                    <button onclick="toggleQuality('${cam.id}')" id="quality-btn-${cam.id}" title="Ganti Kualitas Stream" class="px-2 py-0.5 font-mono text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700">
                        ${cam.stream_quality === 'hd' ? 'HD' : 'SUB'}
                    </button>
                    ${isAdmin ? `
                    <button onclick="toggleMotionAI('${cam.id}')" id="motion-toggle-${cam.id}" title="Toggle AI Motion Detection" class="p-1.5 ${cam.motion_detection ? 'text-emerald-400' : 'text-slate-500'} hover:bg-slate-800 rounded transition">
                        <i data-lucide="scan" class="w-4 h-4"></i>
                    </button>
                    ` : ''}
                    <button onclick="toggleFullscreen('card-${cam.id}')" title="Layar Penuh" class="p-1.5 hover:bg-cyan-500/20 text-slate-300 hover:text-white rounded transition">
                        <i data-lucide="maximize-2" class="w-4 h-4"></i>
                    </button>
                    ${isAdmin ? `
                    <button onclick="openEditCameraModal('${cam.id}')" title="Pengaturan Kamera" class="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded transition">
                        <i data-lucide="settings" class="w-4 h-4"></i>
                    </button>
                    ` : ''}
                </div>
            </div>
        </div>

        <!-- YouTube-Style Red Seek Bar & DVR Timeshift Scrubber (Garis Merah Seperti YouTube) -->
        <div class="cam-card-dvr-panel px-3 py-2 bg-slate-950/95 border-t border-slate-800/90 flex flex-col gap-1.5 select-none ${canDVR ? '' : 'hidden'}" id="dvr-panel-${cam.id}">
            <!-- Interactive Scrubber Track Area -->
            <div class="dvr-track-area relative w-full py-1.5 cursor-pointer group/yt" id="dvr-track-${cam.id}"
                 onmousedown="startDVRScrubbing('${cam.id}', event)"
                 ontouchstart="startDVRScrubbing('${cam.id}', event)"
                 onmousemove="handleDVRScrubHover('${cam.id}', event)"
                 onmouseleave="hideDVRTooltip('${cam.id}')">
                
                <!-- Hover Tooltip ala YouTube -->
                <div id="dvr-tooltip-${cam.id}" class="absolute -top-7 -translate-x-1/2 px-2 py-0.5 bg-slate-900 border border-red-500/60 text-white rounded text-[10px] font-mono shadow pointer-events-none hidden z-20">
                    LIVE
                </div>

                <!-- Background Track -->
                <div class="dvr-bg-track w-full h-1.5 group-hover/yt:h-2.5 bg-slate-800 rounded-full overflow-hidden transition-all duration-150 relative">
                    <!-- Buffer Bar (grey/white) -->
                    <div id="dvr-buffer-${cam.id}" class="absolute top-0 bottom-0 left-0 bg-slate-600/60 rounded-full" style="width: 100%;"></div>
                    <!-- Played Red Line ala YouTube (Garis Merah) -->
                    <div id="dvr-red-line-${cam.id}" class="absolute top-0 bottom-0 left-0 bg-red-600 rounded-full transition-all" style="width: 100%;"></div>
                </div>

                <!-- Red Scrubber Circle / Thumb (Bulatan Merah ala YouTube) -->
                <div id="dvr-thumb-${cam.id}" class="dvr-scrub-thumb absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 group-hover/yt:w-4 group-hover/yt:h-4 bg-red-600 border-2 border-white rounded-full shadow-md shadow-red-600/70 pointer-events-none transition-transform" style="left: 100%;"></div>
            </div>

            <!-- Controls Under Red Bar: Live Badge, Rewind 10s, Forward 10s, Status Label, Quick Actions -->
            <div class="cam-card-dvr-controls flex items-center justify-between text-xs text-slate-300">
                <div class="flex items-center gap-2">
                    <!-- Live Badge / Return to Live button ala YouTube -->
                    <button onclick="returnToLive('${cam.id}')" id="dvr-live-btn-${cam.id}" class="flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-red-600/20 text-red-400 border border-red-500/40 hover:bg-red-600/30 transition" title="Klik untuk kembali ke siaran LANGSUNG (LIVE)">
                        <span class="w-2 h-2 rounded-full bg-red-500 animate-ping" id="dvr-live-dot-${cam.id}"></span>
                        <span id="dvr-status-text-${cam.id}">LIVE</span>
                    </button>

                    <!-- Rewind 10s button -->
                    <button onclick="quickRewindLive('${cam.id}', 10)" class="p-1 hover:text-cyan-400 text-slate-400 transition flex items-center text-[10px] font-mono gap-0.5" title="Mundur 10 Detik">
                        <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> -10s
                    </button>

                    <!-- Forward 10s button -->
                    <button onclick="quickRewindLive('${cam.id}', -10)" class="p-1 hover:text-cyan-400 text-slate-400 transition flex items-center text-[10px] font-mono gap-0.5" title="Maju 10 Detik">
                        +10s <i data-lucide="rotate-cw" class="w-3.5 h-3.5"></i>
                    </button>

                    <span id="dvr-time-label-${cam.id}" class="font-mono text-[11px] text-slate-400 truncate max-w-[120px] sm:max-w-none">Siaran Langsung (Real-Time)</span>
                </div>

                <div class="flex items-center gap-1.5">
                    ${canSnapshot ? `
                    <button onclick="takeSnapshot('${cam.id}')" class="p-1 hover:text-cyan-400 text-slate-400 transition" title="Ambil Foto Snapshot">
                        <i data-lucide="camera" class="w-4 h-4"></i>
                    </button>
                    ` : ''}
                    ${canRecord ? `
                    <button onclick="toggleRecord('${cam.id}')" id="dvr-rec-btn-${cam.id}" class="p-1 hover:text-red-400 text-slate-400 transition" title="Rekam Video Clip">
                        <i data-lucide="circle-dot" class="w-4 h-4"></i>
                    </button>
                    ` : ''}
                    ${isAdmin ? `
                    <button onclick="openMaskModal('${cam.id}', '${cam.name}')" class="p-1 hover:text-amber-400 text-slate-400 transition" title="Sensor Privacy Masking">
                        <i data-lucide="eye-off" class="w-4 h-4"></i>
                    </button>
                    ` : ''}
                    <button onclick="toggleFullscreen('card-${cam.id}')" class="p-1 hover:text-cyan-400 text-slate-400 transition" title="Layar Penuh">
                        <i data-lucide="maximize" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>
        </div>
    `;

    return div;
}

// Select a specific camera when in Single View (1x1)
function selectCameraForSingleView(camId) {
    state.selectedCameraId = camId;
    if (state.currentLayout === 'grid-1x1') {
        renderCameraGrid();
    }
}

const streamReconnectTimeouts = {};

// Clean Stream Reconnect on Error or Refresh
function reloadStream(camId) {
    if (streamReconnectTimeouts[camId]) {
        clearTimeout(streamReconnectTimeouts[camId]);
        streamReconnectTimeouts[camId] = null;
    }
    const img = document.getElementById(`img-${camId}`);
    if (img) {
        const tokenParam = state.authToken ? `&token=${encodeURIComponent(state.authToken)}` : '';
        img.src = `/stream/${camId}?t=${Date.now()}${tokenParam}`;
    }
}

function handleStreamError(camId) {
    // Prevent continuous flashing/flickering loops by using a gentle debounced reconnect
    if (streamReconnectTimeouts[camId]) return;

    streamReconnectTimeouts[camId] = setTimeout(() => {
        streamReconnectTimeouts[camId] = null;
        const img = document.getElementById(`img-${camId}`);
        if (img) {
            const tokenParam = state.authToken ? `&token=${encodeURIComponent(state.authToken)}` : '';
            img.src = `/stream/${camId}?t=${Date.now()}${tokenParam}`;
        }
    }, 2500);
}

// Layout Switcher - Seamless, never wipes HTML or disconnects streams
function setLayout(layout) {
    state.currentLayout = layout;
    try {
        localStorage.setItem('cctv_layout', layout);
    } catch (e) {}
    document.querySelectorAll('.layout-btn').forEach(btn => {
        btn.classList.remove('bg-cyan-500/20', 'text-cyan-400', 'border-cyan-500/40');
        btn.classList.add('text-slate-400');
    });
    const activeBtn = document.getElementById(`btn-${layout}`);
    if (activeBtn) {
        activeBtn.classList.add('bg-cyan-500/20', 'text-cyan-400', 'border-cyan-500/40');
        activeBtn.classList.remove('text-slate-400');
    }
    
    const gridContainer = document.getElementById('camera-grid');
    if (gridContainer) {
        gridContainer.className = 'grid gap-4 transition-all duration-300 ' + getGridClass(state.currentLayout);
    }
    state.cameras.forEach((cam, index) => {
        const card = document.getElementById(`card-${cam.id}`);
        if (card) {
            applyLayoutToCard(card, index);
        }
    });
}

// Periodic Telemetry Poller (FPS, Motion, Resolution)
async function pollStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        if (!data || !data.cameras) return;

        let motionDetectedNow = false;

        data.cameras.forEach(cam => {
            // Update cached camera state
            const target = state.cameras.find(c => c.id === cam.id);
            if (target) {
                target.connected = cam.connected;
                target.fps = cam.fps;
                target.resolution = cam.resolution;
                target.motion = cam.motion;
                target.is_recording = cam.is_recording;
            }

            // Update DOM tags
            const fpsEl = document.getElementById(`fps-${cam.id}`);
            if (fpsEl) fpsEl.textContent = `${cam.fps || 0} FPS`;

            const resEl = document.getElementById(`res-${cam.id}`);
            if (resEl) resEl.textContent = cam.resolution || '640x360';

            // Feature E: Update Network Health & Ping Badge
            const pingEl = document.getElementById(`ping-${cam.id}`);
            const pingValEl = document.getElementById(`ping-val-${cam.id}`);
            if (pingEl && pingValEl) {
                if (cam.connected && cam.ping_ms !== null && cam.ping_ms !== undefined) {
                    pingValEl.textContent = `${cam.ping_ms}ms`;
                    if (cam.ping_ms < 40) {
                        pingEl.className = 'font-mono text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1';
                        pingEl.title = `Ping: ${cam.ping_ms} ms • Sinyal Wi-Fi Sangat Baik`;
                    } else if (cam.ping_ms < 100) {
                        pingEl.className = 'font-mono text-xs px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 flex items-center gap-1';
                        pingEl.title = `Ping: ${cam.ping_ms} ms • Sinyal Wi-Fi Stabil`;
                    } else if (cam.ping_ms < 200) {
                        pingEl.className = 'font-mono text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1';
                        pingEl.title = `Ping: ${cam.ping_ms} ms • Sinyal Wi-Fi Cukup / Agak Jauh`;
                    } else {
                        pingEl.className = 'font-mono text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/40 flex items-center gap-1';
                        pingEl.title = `Ping: ${cam.ping_ms} ms • Sinyal Wi-Fi Lemah / Lag`;
                    }
                } else if (!cam.connected) {
                    pingValEl.textContent = 'OFFLINE';
                    pingEl.className = 'font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700/60 flex items-center gap-1';
                    pingEl.title = 'Kamera Tidak Terhubung';
                }
            }

            const card = document.getElementById(`card-${cam.id}`);
            const headerMotion = document.getElementById(`header-motion-${cam.id}`);
            if (cam.motion) {
                motionDetectedNow = true;
                if (card) card.classList.add('motion-alert-active');
                if (headerMotion) {
                    headerMotion.classList.remove('hidden');
                    headerMotion.classList.add('inline-flex');
                }
            } else {
                if (card) card.classList.remove('motion-alert-active');
                if (headerMotion) {
                    headerMotion.classList.add('hidden');
                    headerMotion.classList.remove('inline-flex');
                }
            }

            const recBanner = document.getElementById(`rec-banner-${cam.id}`);
            const recBtn = document.getElementById(`rec-btn-${cam.id}`);
            if (recBanner) {
                if (cam.is_recording) {
                    recBanner.classList.remove('hidden');
                    recBanner.classList.add('flex');
                    if (recBtn) recBtn.className = 'p-1.5 bg-red-500/30 text-red-400 rounded animate-pulse';
                } else {
                    recBanner.classList.add('hidden');
                    recBanner.classList.remove('flex');
                    if (recBtn) recBtn.className = 'p-1.5 hover:bg-red-500/20 text-slate-300 rounded transition';
                }
            }
        });

        if (motionDetectedNow) {
            playAlertSound('motion');
        }

        updateHeaderBadges();
        checkArmingStatus();

        const emapModal = document.getElementById('emap-modal');
        if (emapModal && !emapModal.classList.contains('hidden')) {
            renderEmapMarkers();
        }
    } catch (e) {
        console.warn('Poll stats failed:', e);
    }
}

// Camera Actions: Snapshot
async function takeSnapshot(camId) {
    try {
        playAlertSound('snap');
        showToast('Mengambil snapshot foto...', 'info');
        const res = await fetch(`/api/snapshot/${camId}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Snapshot tersimpan!', 'success');
        } else {
            showToast('Gagal mengambil snapshot: ' + data.error, 'error');
        }
    } catch (e) {
        showToast('Error mengambil snapshot', 'error');
    }
}

// Camera Actions: Toggle Recording
async function toggleRecord(camId) {
    const cam = state.cameras.find(c => c.id === camId);
    if (!cam) return;

    try {
        if (!cam.is_recording) {
            const res = await fetch(`/api/record/${camId}/start`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                cam.is_recording = true;
                showToast(`Perekaman dimulai (${data.filename})`, 'success');
            } else {
                showToast('Gagal memulai perekaman: ' + data.error, 'error');
            }
        } else {
            const res = await fetch(`/api/record/${camId}/stop`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                cam.is_recording = false;
                showToast(`Video tersimpan di Galeri (${data.filename})`, 'success');
            } else {
                showToast('Gagal menghentikan perekaman', 'error');
            }
        }
    } catch (e) {
        showToast('Error pemicu perekaman', 'error');
    }
}

// Camera Actions: Toggle Stream Quality
async function toggleQuality(camId) {
    const cam = state.cameras.find(c => c.id === camId);
    if (!cam) return;
    const newQuality = cam.stream_quality === 'hd' ? 'sub' : 'hd';
    try {
        const res = await fetch(`/api/cameras/${camId}/stream-quality`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quality: newQuality })
        });
        const data = await res.json();
        if (data.success) {
            cam.stream_quality = newQuality;
            const btn = document.getElementById(`quality-btn-${camId}`);
            if (btn) btn.textContent = newQuality.toUpperCase();
            showToast(`Kualitas stream diubah ke ${newQuality.toUpperCase()}`, 'info');
        }
    } catch (e) {
        showToast('Gagal mengubah kualitas stream', 'error');
    }
}

// Camera Actions: Change Filter
async function changeFilter(camId, filterMode) {
    try {
        const res = await fetch(`/api/cameras/${camId}/filter`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filter: filterMode })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`Filter: ${filterMode.toUpperCase()}`, 'info');
        }
    } catch (e) {
        showToast('Gagal mengubah filter', 'error');
    }
}

// Camera Actions: Toggle Motion AI
async function toggleMotionAI(camId) {
    const cam = state.cameras.find(c => c.id === camId);
    if (!cam) return;
    const newState = !cam.motion_detection;
    try {
        const res = await fetch(`/api/cameras/${camId}/toggle-motion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: newState })
        });
        const data = await res.json();
        if (data.success) {
            cam.motion_detection = newState;
            const btn = document.getElementById(`motion-toggle-${camId}`);
            if (btn) {
                btn.className = `p-1.5 ${newState ? 'text-emerald-400' : 'text-slate-500'} hover:bg-slate-800 rounded transition`;
            }
            showToast(`AI Motion: ${newState ? 'AKTIF' : 'NONAKTIF'}`, 'info');
        }
    } catch (e) {
        showToast('Gagal mengatur Motion AI', 'error');
    }
}

// PTZ Modal & Controller
function openPTZModal(camId, name, ip) {
    requirePin(() => {
        state.ptzActiveCamId = camId;
        document.getElementById('ptz-cam-title').textContent = `${name} (${ip})`;
        document.getElementById('ptz-modal').classList.remove('hidden');
        document.getElementById('ptz-modal').classList.add('flex');
    });
}

function closePTZModal() {
    state.ptzActiveCamId = null;
    document.getElementById('ptz-modal').classList.add('hidden');
    document.getElementById('ptz-modal').classList.remove('flex');
}

async function sendPTZNudge(direction) {
    if (!state.ptzActiveCamId) return;
    const speed = parseFloat(document.getElementById('ptz-speed-slider').value) || 0.5;
    try {
        await fetch(`/api/ptz/${state.ptzActiveCamId}/nudge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ direction, speed })
        });
    } catch (e) {
        console.warn('PTZ nudge failed:', e);
    }
}

// ONVIF Network Scanner Modal
function openScanModal() {
    document.getElementById('scan-modal').classList.remove('hidden');
    document.getElementById('scan-modal').classList.add('flex');
    if (state.scanResults.length === 0) {
        runNetworkScan();
    }
}

function closeScanModal() {
    document.getElementById('scan-modal').classList.add('hidden');
    document.getElementById('scan-modal').classList.remove('flex');
}

async function runNetworkScan() {
    const statusText = document.getElementById('scan-status-text');
    const resultsContainer = document.getElementById('scan-results-list');
    const scanBtn = document.getElementById('btn-start-scan');
    const prefix = document.getElementById('scan-prefix-input').value.trim() || '192.168.1.';

    state.isScanning = true;
    if (scanBtn) scanBtn.disabled = true;
    statusText.textContent = `Memindai subnet ${prefix}0/24 dengan ONVIF WS-Discovery...`;
    resultsContainer.innerHTML = `
        <div class="py-12 text-center">
            <div class="radar-sweep-circle mx-auto mb-4">
                <div class="radar-sweep-beam"></div>
            </div>
            <p class="font-mono text-xs text-cyan-400 animate-pulse">Scanning WS-Discovery Multicast (UDP 3702) & RTSP Ports...</p>
        </div>
    `;

    try {
        const res = await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix, start: 1, end: 120 })
        });
        const data = await res.json();
        state.scanResults = data.devices || [];
        statusText.textContent = `Selesai! Ditemukan ${data.count} kamera ONVIF.`;
        renderScanResults();
    } catch (e) {
        statusText.textContent = 'Pemindaian gagal. Pastikan jaringan terhubung.';
    } finally {
        state.isScanning = false;
        if (scanBtn) scanBtn.disabled = false;
    }
}

function renderScanResults() {
    const list = document.getElementById('scan-results-list');
    if (!list) return;

    if (state.scanResults.length === 0) {
        list.innerHTML = `
            <div class="py-8 text-center text-slate-400">
                <p>Tidak ada perangkat ONVIF yang merespons pada subnet ini.</p>
            </div>
        `;
        return;
    }

    list.innerHTML = state.scanResults.map((dev, idx) => `
        <div class="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between hover:border-cyan-500/40 transition">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                    <i data-lucide="cctv" class="w-5 h-5"></i>
                </div>
                <div>
                    <h5 class="font-tech font-bold text-sm text-slate-100 flex items-center gap-2">
                        ${dev.manufacturer} ${dev.model}
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">ONVIF</span>
                    </h5>
                    <p class="font-mono text-xs text-cyan-400/90">${dev.ip}:${dev.onvif_port}</p>
                    <p class="text-[11px] text-slate-500 truncate max-w-xs md:max-w-md">RTSP: ${dev.rtsp_sub || dev.rtsp_main}</p>
                </div>
            </div>

            <button onclick="addDiscoveredCamera(${idx})" class="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold rounded-lg flex items-center gap-1.5 transition">
                <i data-lucide="plus" class="w-3.5 h-3.5"></i> Tambah
            </button>
        </div>
    `).join('');

    lucide.createIcons();
}

async function addDiscoveredCamera(index) {
    const dev = state.scanResults[index];
    if (!dev) return;

    const newCam = {
        name: `CAM ${dev.ip.split('.').pop()} - ${dev.model}`,
        ip: dev.ip,
        onvif_port: dev.onvif_port || 8899,
        rtsp_url: dev.rtsp_sub || dev.rtsp_main,
        rtsp_hd_url: dev.rtsp_main,
        type: 'onvif',
        has_ptz: dev.has_ptz,
        stream_quality: 'sub',
        motion_detection: true,
        filter: 'normal',
        enabled: true
    };

    try {
        const res = await fetch('/api/cameras', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newCam)
        });
        const data = await res.json();
        if (data.success) {
            showToast(`Kamera ${dev.ip} berhasil ditambahkan!`, 'success');
            closeScanModal();
            fetchCameras();
        }
    } catch (e) {
        showToast('Gagal menambahkan kamera', 'error');
    }
}

// Gallery & Recordings Modal
async function openGalleryModal() {
    document.getElementById('gallery-modal').classList.remove('hidden');
    document.getElementById('gallery-modal').classList.add('flex');
    loadGalleryItems();
}

function closeGalleryModal() {
    document.getElementById('gallery-modal').classList.add('hidden');
    document.getElementById('gallery-modal').classList.remove('flex');
}

async function loadGalleryItems(filterType = 'all') {
    const container = document.getElementById('gallery-grid');
    container.innerHTML = '<div class="col-span-full py-12 text-center text-slate-500">Memuat galeri...</div>';

    try {
        const res = await fetch('/api/gallery');
        const data = await res.json();
        let items = data.items || [];
        state.allGalleryItems = items;
        renderTimeline(items);

        if (filterType !== 'all') {
            items = items.filter(it => it.type === filterType);
        }

        if (items.length === 0) {
            container.innerHTML = '<div class="col-span-full py-16 text-center text-slate-500">Belum ada file tersimpan.</div>';
            return;
        }

        container.innerHTML = items.map(item => {
            const dateStr = new Date(item.timestamp * 1000).toLocaleString('id-ID');
            const isVideo = item.type === 'recording';
            return `
                <div id="gallery-item-${item.filename}" class="glass-panel rounded-lg overflow-hidden border border-slate-800 flex flex-col group transition-all duration-300 hover:border-cyan-500/40">
                    <div class="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
                        ${isVideo ? `
                            <div onclick="openCinemaPlayer('${item.url}', '${item.filename}', '${item.type}', ${item.timestamp})" class="relative w-full h-full cursor-pointer flex items-center justify-center group/vid bg-black">
                                <video src="${item.url}#t=0.5" preload="metadata" class="w-full h-full object-contain pointer-events-none opacity-80 group-hover/vid:opacity-100 transition"></video>
                                <div class="absolute inset-0 bg-slate-950/40 group-hover/vid:bg-black/20 flex items-center justify-center transition">
                                    <div class="w-12 h-12 rounded-full bg-red-600/90 text-white flex items-center justify-center shadow-lg group-hover/vid:scale-110 transition-transform">
                                        <i data-lucide="play" class="w-6 h-6 fill-white ml-0.5"></i>
                                    </div>
                                </div>
                                <div class="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/85 text-[10px] font-mono text-cyan-300 flex items-center gap-1 border border-cyan-500/30">
                                    <i data-lucide="youtube" class="w-3.5 h-3.5 text-red-500"></i> Buka Player
                                </div>
                            </div>
                        ` : `
                            <img src="${item.url}" alt="${item.filename}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                        `}
                        <span class="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-bold ${
                            item.type === 'event' ? 'bg-red-900/90 text-red-300' : (isVideo ? 'bg-amber-900/90 text-amber-300' : 'bg-cyan-900/90 text-cyan-300')
                        }">
                            ${item.type}
                        </span>
                    </div>

                    <div class="p-2.5 bg-slate-900/90 flex items-center justify-between text-xs">
                        <div class="truncate">
                            <p class="font-mono text-[11px] text-slate-300 truncate">${item.filename}</p>
                            <span class="text-[10px] text-slate-500">${dateStr}</span>
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0">
                            <a href="${item.url}" download="${item.filename}" class="p-1 hover:bg-cyan-500/20 text-cyan-400 rounded transition" title="Unduh">
                                <i data-lucide="download" class="w-4 h-4"></i>
                            </a>
                            <button onclick="deleteGalleryItem('${item.filename}', '${item.type}')" class="p-1 hover:bg-red-500/20 text-red-400 rounded transition" title="Hapus">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        lucide.createIcons();
    } catch (e) {
        container.innerHTML = '<div class="col-span-full py-12 text-center text-red-400">Gagal memuat galeri.</div>';
    }
}

async function deleteGalleryItem(filename, type) {
    requirePin(async () => {
        const confirmed = await showConfirmDialog({
            title: 'Hapus File Media',
            message: `Apakah Anda yakin ingin menghapus file "${filename}" secara permanen?`,
            confirmText: 'Ya, Hapus File',
            cancelText: 'Batal',
            type: 'danger'
        });
        if (!confirmed) return;
        try {
            const res = await fetch('/api/gallery/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename, type })
            });
            const data = await res.json();
            if (data.success) {
                showToast('File berhasil dihapus dari server', 'success');
                loadGalleryItems();
            }
        } catch (e) {
            showToast('Gagal menghapus file', 'error');
        }
    });
}

// Add / Edit Camera Modal
function openAddCameraModal() {
    document.getElementById('modal-cam-id').value = '';
    document.getElementById('modal-cam-name').value = '';
    document.getElementById('modal-cam-ip').value = '';
    document.getElementById('modal-cam-onvif-port').value = '8899';
    document.getElementById('modal-cam-rtsp-url').value = '';
    document.getElementById('modal-cam-ptz').checked = true;
    document.getElementById('modal-cam-title').textContent = 'Tambah Kamera Manual';
    document.getElementById('camera-modal').classList.remove('hidden');
    document.getElementById('camera-modal').classList.add('flex');
}

function openEditCameraModal(camId) {
    const cam = state.cameras.find(c => c.id === camId);
    if (!cam) return;
    document.getElementById('modal-cam-id').value = cam.id;
    document.getElementById('modal-cam-name').value = cam.name;
    document.getElementById('modal-cam-ip').value = cam.ip;
    document.getElementById('modal-cam-onvif-port').value = cam.onvif_port || 8899;
    document.getElementById('modal-cam-rtsp-url').value = cam.rtsp_url || '';
    document.getElementById('modal-cam-ptz').checked = !!cam.has_ptz;
    document.getElementById('modal-cam-title').textContent = 'Pengaturan Kamera';
    document.getElementById('camera-modal').classList.remove('hidden');
    document.getElementById('camera-modal').classList.add('flex');
}

function closeCameraModal() {
    document.getElementById('camera-modal').classList.add('hidden');
    document.getElementById('camera-modal').classList.remove('flex');
}

async function saveCameraModal() {
    const camId = document.getElementById('modal-cam-id').value;
    const name = document.getElementById('modal-cam-name').value.trim();
    const ip = document.getElementById('modal-cam-ip').value.trim();
    const onvifPort = parseInt(document.getElementById('modal-cam-onvif-port').value) || 8899;
    let rtspUrl = document.getElementById('modal-cam-rtsp-url').value.trim();
    const hasPtz = document.getElementById('modal-cam-ptz').checked;

    if (!ip) {
        showToast('IP Kamera wajib diisi', 'error');
        return;
    }

    if (!rtspUrl) {
        rtspUrl = `rtsp://${ip}/live/ch00_1`;
    }

    const payload = {
        name: name || `Camera ${ip}`,
        ip,
        onvif_port: onvifPort,
        rtsp_url: rtspUrl,
        rtsp_hd_url: `rtsp://${ip}/live/ch00_0`,
        has_ptz: hasPtz,
        type: ip === '127.0.0.1' ? 'simulated' : 'onvif'
    };

    try {
        if (camId) {
            // Update
            await fetch(`/api/cameras/${camId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            showToast('Kamera diperbarui!', 'success');
        } else {
            // Add
            await fetch('/api/cameras', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            showToast('Kamera ditambahkan!', 'success');
        }
        closeCameraModal();
        fetchCameras();
    } catch (e) {
        showToast('Gagal menyimpan kamera', 'error');
    }
}

// Fullscreen Toggle
function toggleFullscreen(elementId) {
    const el = elementId ? document.getElementById(elementId) : document.documentElement;
    if (!document.fullscreenElement) {
        if (el.requestFullscreen) el.requestFullscreen();
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
    }
}

// Sound Toggle
function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    const btn = document.getElementById('btn-sound-toggle');
    if (btn) {
        btn.innerHTML = state.soundEnabled ? 
            '<i data-lucide="volume-2" class="w-4 h-4"></i>' : 
            '<i data-lucide="volume-x" class="w-4 h-4 text-red-400"></i>';
        lucide.createIcons();
    }
    showToast(`Audio Alert: ${state.soundEnabled ? 'AKTIF' : 'SENYAP'}`, 'info');
}

// AI Face Auto-Zoom Toggle Button Controller (User Request)
async function toggleFaceAutoZoom() {
    const currentVal = state.settings.face_auto_zoom_enabled !== false;
    const newVal = !currentVal;
    
    state.settings.face_auto_zoom_enabled = newVal;
    updateFaceZoomBtnUI(newVal);

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ face_auto_zoom_enabled: newVal })
        });
        const data = await res.json();
        if (data.success) {
            state.settings = data.settings;
            const isEnabled = state.settings.face_auto_zoom_enabled !== false;
            updateFaceZoomBtnUI(isEnabled);
            const cfgBox = document.getElementById('cfg-face-zoom-enabled');
            if (cfgBox) cfgBox.checked = isEnabled;
            showToast(`AI Face Auto-Zoom (2 Detik): ${isEnabled ? 'AKTIF' : 'NONAKTIF'}`, isEnabled ? 'success' : 'info');
        } else {
            showToast('Gagal mengubah pengaturan Auto-Zoom', 'error');
        }
    } catch (e) {
        showToast('Error koneksi saat mengatur Auto-Zoom', 'error');
    }
}

function updateFaceZoomBtnUI(isEnabled) {
    const btn = document.getElementById('btn-face-zoom-toggle');
    if (!btn) return;
    if (isEnabled) {
        btn.className = 'p-2 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 hover:bg-cyan-500/30 transition shadow-lg shadow-cyan-500/10';
        btn.title = 'AI Face Auto-Zoom: AKTIF (Otomatis zoom wajah sesuai akurasi. Klik untuk matikan)';
        btn.innerHTML = '<i data-lucide="scan-face" class="w-4 h-4"></i>';
    } else {
        btn.className = 'p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-500 border border-slate-700 transition';
        btn.title = 'AI Face Auto-Zoom: NONAKTIF (Klik untuk aktifkan)';
        btn.innerHTML = '<i data-lucide="scan-face" class="w-4 h-4 text-slate-500 opacity-60"></i>';
    }
    if (window.lucide && lucide.createIcons) {
        lucide.createIcons();
    }
}

function updateFaceThresholdBadge(val) {
    const badge = document.getElementById('face-thresh-badge');
    if (!badge) return;
    const num = parseInt(val) || 50;
    badge.textContent = `${num}%`;
    if (num < 40) {
        badge.className = 'px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold text-xs border border-amber-500/40';
    } else if (num <= 65) {
        badge.className = 'px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono font-bold text-xs border border-cyan-500/40';
    } else {
        badge.className = 'px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold text-xs border border-emerald-500/40';
    }
}

function toggleFaceOptionsPanel(isOpen) {
    const panel = document.getElementById('face-zoom-options');
    if (!panel) return;
    if (isOpen) {
        panel.classList.remove('opacity-40', 'pointer-events-none');
    } else {
        panel.classList.add('opacity-40', 'pointer-events-none');
    }
}

// ==========================================
// CYBER TOAST NOTIFICATIONS & CONFIRM DIALOG
// ==========================================

function showToast(message, type = 'info', customTitle = null) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toastId = 'toast-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const toast = document.createElement('div');
    toast.id = toastId;
    toast.className = 'pointer-events-auto transform transition-all duration-300 translate-x-full opacity-0 glass-panel rounded-xl p-3.5 border shadow-2xl flex items-start gap-3 backdrop-blur-xl relative overflow-hidden select-none';

    let icon = 'info';
    let borderColor = 'border-cyan-500/50 bg-slate-950/95 shadow-cyan-500/10';
    let iconColor = 'text-cyan-400 bg-cyan-500/15 border-cyan-500/30';
    let defaultTitle = 'INFORMASI SISTEM';

    if (type === 'success') {
        icon = 'check-circle-2';
        borderColor = 'border-emerald-500/50 bg-slate-950/95 shadow-emerald-500/10';
        iconColor = 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30';
        defaultTitle = 'BERHASIL';
    } else if (type === 'error' || type === 'danger') {
        icon = 'alert-octagon';
        borderColor = 'border-red-500/50 bg-slate-950/95 shadow-red-500/10';
        iconColor = 'text-red-400 bg-red-500/15 border-red-500/30';
        defaultTitle = 'PERINGATAN SISTEM';
    } else if (type === 'warning') {
        icon = 'alert-triangle';
        borderColor = 'border-amber-500/50 bg-slate-950/95 shadow-amber-500/10';
        iconColor = 'text-amber-400 bg-amber-500/15 border-amber-500/30';
        defaultTitle = 'PERHATIAN';
    }

    toast.className += ' ' + borderColor;

    toast.innerHTML = `
        <div class="w-8 h-8 rounded-lg ${iconColor} border flex items-center justify-center shrink-0 mt-0.5">
            <i data-lucide="${icon}" class="w-4 h-4"></i>
        </div>
        <div class="flex-1 min-w-0 pr-4">
            <div class="text-[10px] font-mono tracking-wider text-slate-400 font-bold uppercase mb-0.5">${customTitle || defaultTitle}</div>
            <div class="text-xs text-slate-100 font-medium leading-relaxed break-words">${message}</div>
        </div>
        <button onclick="dismissToast('${toastId}')" class="text-slate-500 hover:text-slate-300 p-1 shrink-0 transition" title="Tutup Notifikasi">
            <i data-lucide="x" class="w-3.5 h-3.5"></i>
        </button>
        <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-800 overflow-hidden">
            <div class="h-full bg-cyan-400 transition-all linear" id="${toastId}-prog" style="width: 100%;"></div>
        </div>
    `;

    container.appendChild(toast);
    if (window.lucide && lucide.createIcons) lucide.createIcons();

    requestAnimationFrame(() => {
        toast.classList.remove('translate-x-full', 'opacity-0');
        toast.classList.add('translate-x-0', 'opacity-100');
        const prog = document.getElementById(`${toastId}-prog`);
        if (prog) {
            prog.style.transitionDuration = '3500ms';
            prog.style.width = '0%';
        }
    });

    setTimeout(() => {
        dismissToast(toastId);
    }, 3800);
}

function dismissToast(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('translate-x-0', 'opacity-100');
    el.classList.add('translate-x-full', 'opacity-0');
    setTimeout(() => {
        if (el && el.parentNode) el.remove();
    }, 300);
}

function showConfirmDialog({
    title = 'Konfirmasi Tindakan',
    message = 'Apakah Anda yakin ingin melanjutkan?',
    confirmText = 'Lanjutkan',
    cancelText = 'Batal',
    type = 'danger'
} = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const box = document.getElementById('confirm-modal-box');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-message');
        const okBtn = document.getElementById('confirm-btn-ok');
        const cancelBtn = document.getElementById('confirm-btn-cancel');
        const iconWrapper = document.getElementById('confirm-icon-wrapper');
        const iconEl = document.getElementById('confirm-icon');

        if (!modal) {
            resolve(confirm(message));
            return;
        }

        titleEl.textContent = title;
        msgEl.textContent = message;
        cancelBtn.textContent = cancelText;
        okBtn.innerHTML = `<span>${confirmText}</span>`;

        if (type === 'danger') {
            iconWrapper.className = 'w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center text-red-400 bg-red-500/10 border border-red-500/30 shadow-lg shadow-red-500/15';
            iconEl.setAttribute('data-lucide', 'alert-triangle');
            okBtn.className = 'flex-1 py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs border border-red-500 shadow-lg shadow-red-600/30 active:scale-95 transition flex items-center justify-center gap-1.5';
            box.className = 'glass-panel rounded-2xl w-full max-w-sm p-6 border shadow-2xl relative text-center border-red-500/40 bg-slate-950/95 transition-all duration-200';
        } else if (type === 'warning') {
            iconWrapper.className = 'w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center text-amber-400 bg-amber-500/10 border border-amber-500/30 shadow-lg shadow-amber-500/15';
            iconEl.setAttribute('data-lucide', 'help-circle');
            okBtn.className = 'flex-1 py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs border border-amber-500 shadow-lg shadow-amber-600/30 active:scale-95 transition flex items-center justify-center gap-1.5';
            box.className = 'glass-panel rounded-2xl w-full max-w-sm p-6 border shadow-2xl relative text-center border-amber-500/40 bg-slate-950/95 transition-all duration-200';
        } else {
            iconWrapper.className = 'w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 shadow-lg shadow-cyan-500/15';
            iconEl.setAttribute('data-lucide', 'info');
            okBtn.className = 'flex-1 py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs border border-cyan-400 shadow-lg shadow-cyan-500/30 active:scale-95 transition flex items-center justify-center gap-1.5';
            box.className = 'glass-panel rounded-2xl w-full max-w-sm p-6 border shadow-2xl relative text-center border-cyan-500/40 bg-slate-950/95 transition-all duration-200';
        }

        if (window.lucide && lucide.createIcons) lucide.createIcons();

        modal.classList.remove('hidden');
        modal.classList.add('flex');

        function cleanup(result) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            resolve(result);
        }

        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
    });
}

// Manual Trigger for DHCP IP Auto-Healing
async function triggerDHCPAutoHeal() {
    const btn = document.getElementById('btn-auto-heal');
    if (btn) btn.classList.add('animate-spin');
    showToast('Memindai dan mensinkronisasi IP kamera (DHCP Tracking)...', 'info');
    try {
        const res = await fetch('/api/auto-heal', { method: 'POST' });
        const data = await res.json();
        if (data.healed && data.healed.length > 0) {
            data.healed.forEach(item => {
                showToast(`[Auto-Heal] ${item.name} berhasil disambungkan ke IP baru ${item.new_ip}!`, 'success');
            });
            fetchCameras();
        } else {
            showToast('Semua IP kamera stabil & sinkron!', 'success');
        }
    } catch (e) {
        showToast('Gagal menjalankan DHCP Auto-Heal', 'error');
    } finally {
        if (btn) btn.classList.remove('animate-spin');
    }
}

// ==========================================
// 1. AUTO-PATROL CAROUSEL CONTROLLER
// ==========================================
function togglePatrolMode() {
    state.isPatrolling = !state.isPatrolling;
    const btn = document.getElementById('btn-patrol');
    const txt = document.getElementById('patrol-btn-text');

    if (state.isPatrolling) {
        if (btn) {
            btn.className = 'px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 text-xs font-semibold flex items-center gap-1.5 transition animate-pulse';
        }
        if (txt) txt.textContent = 'Patrol: ON';
        showToast(`Auto-Patrol Aktif (${state.patrolIntervalSec}s per kamera)`, 'success');

        setLayout('grid-1x1');
        state.patrolIndex = 0;
        runPatrolStep();
        state.patrolTimer = setInterval(runPatrolStep, state.patrolIntervalSec * 1000);
    } else {
        if (btn) {
            btn.className = 'px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition';
        }
        if (txt) txt.textContent = 'Patrol';
        if (state.patrolTimer) {
            clearInterval(state.patrolTimer);
            state.patrolTimer = null;
        }
        showToast('Auto-Patrol Dihentikan', 'info');
    }
}

function runPatrolStep() {
    if (!state.isPatrolling || state.cameras.length === 0) return;
    const onlineCams = state.cameras.filter(c => c.connected);
    const pool = onlineCams.length > 0 ? onlineCams : state.cameras;
    
    state.patrolIndex = (state.patrolIndex + 1) % pool.length;
    const targetCam = pool[state.patrolIndex];
    if (targetCam) {
        selectCameraForSingleView(targetCam.id);
        showToast(`[Patrol] Rotasi ke: ${targetCam.name}`, 'info');
    }
}

// ==========================================
// 2. INTERACTIVE E-MAP FLOORPLAN CONTROLLER
// ==========================================
function openEmapModal() {
    document.getElementById('emap-modal').classList.remove('hidden');
    document.getElementById('emap-modal').classList.add('flex');
    renderEmapMarkers();
}

function closeEmapModal() {
    document.getElementById('emap-modal').classList.add('hidden');
    document.getElementById('emap-modal').classList.remove('flex');
    hideEmapPip();
}

function renderEmapMarkers() {
    const container = document.getElementById('emap-markers');
    if (!container) return;

    container.innerHTML = state.cameras.map((cam, idx) => {
        const coord = state.cameraMapCoords[cam.id] || { x: 20 + idx * 20, y: 30 + idx * 15, zone: 'Area CCTV' };
        const isOnline = cam.connected;
        const isMotion = cam.motion;

        let statusColor = 'bg-slate-700 border-slate-500 text-slate-400';
        let pingEl = '';
        if (isMotion) {
            statusColor = 'bg-red-600 border-red-400 text-white shadow-lg shadow-red-500/50';
            pingEl = '<span class="absolute -inset-1 rounded-full bg-red-500 animate-ping opacity-75"></span>';
        } else if (isOnline) {
            statusColor = 'bg-emerald-500 border-emerald-300 text-slate-950 shadow-lg shadow-emerald-500/30';
            pingEl = '<span class="absolute -inset-1 rounded-full bg-emerald-400 animate-pulse opacity-40"></span>';
        }

        return `
            <div class="absolute cursor-pointer transform -translate-x-1/2 -translate-y-1/2 group z-10" 
                 style="left: ${coord.x}%; top: ${coord.y}%;"
                 onclick="showEmapPip('${cam.id}')"
                 title="${cam.name} (${coord.zone})">
                ${pingEl}
                <div class="relative w-8 h-8 rounded-full border-2 ${statusColor} flex items-center justify-center font-mono font-bold text-xs">
                    ${idx + 1}
                </div>
                <div class="absolute left-1/2 -translate-x-1/2 top-9 px-2 py-0.5 bg-slate-950/90 text-cyan-300 border border-slate-700 rounded text-[10px] whitespace-nowrap font-mono pointer-events-none opacity-90 group-hover:opacity-100 transition shadow">
                    ${cam.name}
                </div>
            </div>
        `;
    }).join('');
}

function showEmapPip(camId) {
    const cam = state.cameras.find(c => c.id === camId);
    if (!cam) return;
    const pip = document.getElementById('emap-pip-preview');
    const title = document.getElementById('emap-pip-title');
    const img = document.getElementById('emap-pip-img');
    if (!pip || !title || !img) return;

    title.textContent = cam.name;
    img.src = `/stream/${cam.id}?t=${Date.now()}`;
    pip.classList.remove('hidden');
}

function hideEmapPip() {
    const pip = document.getElementById('emap-pip-preview');
    const img = document.getElementById('emap-pip-img');
    if (img) img.src = '';
    if (pip) pip.classList.add('hidden');
}

// ==========================================
// 3. 24-HOUR TIMELINE PLAYBACK BAR (NVR STYLE)
// ==========================================
function renderTimeline(items = []) {
    const track = document.getElementById('timeline-markers');
    if (!track) return;

    track.innerHTML = items.map(item => {
        const d = new Date(item.timestamp * 1000);
        const mins = d.getHours() * 60 + d.getMinutes();
        const pct = (mins / 1440) * 100;
        
        let colorClass = 'bg-cyan-400 shadow-cyan-400/50';
        let widthClass = 'w-1';
        if (item.type === 'event') {
            colorClass = 'bg-red-500 shadow-red-500/50';
            widthClass = 'w-1.5';
        } else if (item.type === 'recording') {
            colorClass = 'bg-amber-400 shadow-amber-400/50';
            widthClass = 'w-2';
        }

        const timeStr = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        return `
            <div class="absolute top-0 bottom-0 ${widthClass} ${colorClass} rounded-full hover:scale-y-125 transition-transform cursor-pointer shadow"
                 style="left: ${pct.toFixed(2)}%;"
                 onclick="seekTimelineToItem('${item.filename}')"
                 title="${timeStr} - [${item.type.toUpperCase()}] ${item.filename}">
            </div>
        `;
    }).join('');
}

function seekTimelineToItem(filename) {
    const el = document.getElementById(`gallery-item-${filename}`);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-cyan-400', 'shadow-lg', 'shadow-cyan-500/30');
        setTimeout(() => {
            el.classList.remove('ring-2', 'ring-cyan-400', 'shadow-lg', 'shadow-cyan-500/30');
        }, 2500);
    }
}

function handleTimelineClick(event) {
    const track = document.getElementById('timeline-track');
    const scrubber = document.getElementById('timeline-scrubber');
    const label = document.getElementById('timeline-hover-time');
    if (!track) return;

    const rect = track.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (clickX / rect.width) * 100));

    if (scrubber) {
        scrubber.style.left = `${pct}%`;
        scrubber.classList.remove('hidden');
    }

    const totalMins = Math.floor((pct / 100) * 1440);
    const hrs = String(Math.floor(totalMins / 60)).padStart(2, '0');
    const mins = String(totalMins % 60).padStart(2, '0');
    const selectedTime = `${hrs}:${mins}`;

    if (label) {
        label.innerHTML = `Waktu Terpilih: <strong class="text-cyan-300 font-mono">${selectedTime}</strong>`;
    }

    if (state.allGalleryItems.length > 0) {
        let closestItem = null;
        let minDiff = Infinity;
        state.allGalleryItems.forEach(item => {
            const d = new Date(item.timestamp * 1000);
            const itemMins = d.getHours() * 60 + d.getMinutes();
            const diff = Math.abs(itemMins - totalMins);
            if (diff < minDiff) {
                minDiff = diff;
                closestItem = item;
            }
        });

        if (closestItem && minDiff <= 120) {
            seekTimelineToItem(closestItem.filename);
            showToast(`Loncat ke file: ${closestItem.filename} (${selectedTime})`, 'info');
        } else {
            showToast(`Tidak ada rekaman pada jam ${selectedTime}`, 'info');
        }
    }
}

// ==========================================
// 4. STORAGE RETENTION & TELEMETRY
// ==========================================
async function fetchStorageStats() {
    try {
        const res = await fetch('/api/storage');
        const data = await res.json();
        state.storageStats = data;

        const badge = document.getElementById('storage-status-text');
        if (badge) {
            badge.textContent = `Disk: ${data.used_percent}%`;
            if (data.used_percent > 85) {
                badge.parentElement.className = 'font-mono text-xs px-2 py-0.5 rounded bg-red-900/60 text-red-300 border border-red-700 flex items-center gap-1';
            }
        }

        const usageText = document.getElementById('cfg-disk-usage-text');
        const progress = document.getElementById('cfg-disk-progress');
        const snapSize = document.getElementById('cfg-snap-size');
        const recSize = document.getElementById('cfg-rec-size');
        const eventSize = document.getElementById('cfg-event-size');

        if (usageText) usageText.textContent = `${data.used_gb} GB / ${data.total_gb} GB (${data.used_percent}%)`;
        if (progress) {
            progress.style.width = `${data.used_percent}%`;
            progress.className = data.used_percent > 85 ? 'h-full bg-red-500 rounded-full' : 'h-full bg-cyan-400 rounded-full';
        }
        if (snapSize) snapSize.textContent = `Snapshots: ${data.snapshots.size_mb} MB (${data.snapshots.count})`;
        if (recSize) recSize.textContent = `Recordings: ${data.recordings.size_mb} MB (${data.recordings.count})`;
        if (eventSize) eventSize.textContent = `Events: ${data.events.size_mb} MB (${data.events.count})`;
    } catch (e) {
        console.warn('Storage stats error:', e);
    }
}

// ==========================================
// 5. SETTINGS MODAL & TELEGRAM BOT
// ==========================================
function openSettingsModalGuarded() {
    requirePin(() => openSettingsModal());
}

async function openSettingsModal() {
    document.getElementById('settings-modal').classList.remove('hidden');
    document.getElementById('settings-modal').classList.add('flex');
    await loadSettings();
    fetchStorageStats();
}

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.add('hidden');
    document.getElementById('settings-modal').classList.remove('flex');
}

async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (data.settings) {
            state.settings = data.settings;
            const tgl = document.getElementById('cfg-telegram-enabled');
            if (tgl) tgl.checked = !!data.settings.telegram_enabled;
            const tok = document.getElementById('cfg-telegram-token');
            if (tok) tok.value = data.settings.telegram_bot_token || '';
            const cid = document.getElementById('cfg-telegram-chatid');
            if (cid) cid.value = data.settings.telegram_chat_id || '';
            const mod = document.getElementById('cfg-telegram-mode');
            if (mod) mod.value = data.settings.telegram_alert_mode || 'person';

            const ai = document.getElementById('cfg-ai-enabled');
            if (ai) ai.checked = data.settings.ai_detection_enabled !== false;
            const trip = document.getElementById('cfg-tripwire-enabled');
            if (trip) trip.checked = data.settings.virtual_tripwire_enabled !== false;
            const showBoxes = document.getElementById('cfg-show-boxes');
            if (showBoxes) showBoxes.checked = data.settings.show_bounding_boxes !== false;
            const faceZoom = document.getElementById('cfg-face-zoom-enabled');
            if (faceZoom) faceZoom.checked = data.settings.face_auto_zoom_enabled !== false;
            updateFaceZoomBtnUI(data.settings.face_auto_zoom_enabled !== false);
            toggleFaceOptionsPanel(data.settings.face_auto_zoom_enabled !== false);

            const faceThresh = document.getElementById('cfg-face-threshold');
            if (faceThresh) {
                const tv = data.settings.face_zoom_threshold || 50;
                faceThresh.value = tv;
                updateFaceThresholdBadge(tv);
            }
            const faceDur = document.getElementById('cfg-face-duration');
            if (faceDur) faceDur.value = data.settings.face_zoom_duration || 2.0;
            const faceCd = document.getElementById('cfg-face-cooldown');
            if (faceCd) faceCd.value = data.settings.face_zoom_cooldown || 4.0;

            const ret = document.getElementById('cfg-storage-retention');
            if (ret) ret.value = data.settings.storage_retention_days || 14;
            const mx = document.getElementById('cfg-storage-max');
            if (mx) mx.value = data.settings.storage_max_percent || 90;

            const pinTgl = document.getElementById('cfg-pin-enabled');
            if (pinTgl) pinTgl.checked = !!data.settings.pin_enabled;
            const pinVal = document.getElementById('cfg-security-pin');
            if (pinVal) pinVal.value = data.settings.security_pin || '1234';

            // Arming Schedule
            const armMode = document.getElementById('cfg-arming-mode');
            if (armMode) armMode.value = data.settings.arming_mode || 'auto';
            const armStart = document.getElementById('cfg-arming-start');
            if (armStart) armStart.value = data.settings.arming_start_time || '22:00';
            const armEnd = document.getElementById('cfg-arming-end');
            if (armEnd) armEnd.value = data.settings.arming_end_time || '06:00';
            const telUnknown = document.getElementById('cfg-telegram-unknown-faces');
            if (telUnknown) telUnknown.checked = data.settings.telegram_unknown_faces !== false;
        }
    } catch (e) {
        showToast('Gagal memuat pengaturan', 'error');
    }
}

async function saveSettings() {
    const payload = {
        telegram_enabled: document.getElementById('cfg-telegram-enabled').checked,
        telegram_bot_token: document.getElementById('cfg-telegram-token').value.trim(),
        telegram_chat_id: document.getElementById('cfg-telegram-chatid').value.trim(),
        telegram_alert_mode: document.getElementById('cfg-telegram-mode').value,
        ai_detection_enabled: document.getElementById('cfg-ai-enabled').checked,
        show_bounding_boxes: document.getElementById('cfg-show-boxes') ? document.getElementById('cfg-show-boxes').checked : true,
        face_auto_zoom_enabled: document.getElementById('cfg-face-zoom-enabled') ? document.getElementById('cfg-face-zoom-enabled').checked : true,
        face_zoom_threshold: parseInt(document.getElementById('cfg-face-threshold') ? document.getElementById('cfg-face-threshold').value : 50) || 50,
        face_zoom_duration: parseFloat(document.getElementById('cfg-face-duration') ? document.getElementById('cfg-face-duration').value : 2.0) || 2.0,
        face_zoom_cooldown: parseFloat(document.getElementById('cfg-face-cooldown') ? document.getElementById('cfg-face-cooldown').value : 4.0) || 4.0,
        virtual_tripwire_enabled: document.getElementById('cfg-tripwire-enabled').checked,
        storage_retention_days: parseInt(document.getElementById('cfg-storage-retention').value) || 14,
        storage_max_percent: parseInt(document.getElementById('cfg-storage-max').value) || 90,
        pin_enabled: document.getElementById('cfg-pin-enabled').checked,
        security_pin: document.getElementById('cfg-security-pin').value.trim() || '1234',
        arming_mode: document.getElementById('cfg-arming-mode') ? document.getElementById('cfg-arming-mode').value : 'auto',
        arming_start_time: document.getElementById('cfg-arming-start') ? document.getElementById('cfg-arming-start').value : '22:00',
        arming_end_time: document.getElementById('cfg-arming-end') ? document.getElementById('cfg-arming-end').value : '06:00',
        telegram_unknown_faces: document.getElementById('cfg-telegram-unknown-faces') ? document.getElementById('cfg-telegram-unknown-faces').checked : true
    };

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            state.settings = data.settings;
            showToast('Pengaturan sistem berhasil disimpan!', 'success');
            closeSettingsModal();
        }
    } catch (e) {
        showToast('Gagal menyimpan pengaturan', 'error');
    }
}

async function testTelegramBot() {
    const btn = document.getElementById('btn-test-telegram');
    if (btn) btn.classList.add('opacity-50', 'pointer-events-none');
    showToast('Mengirim sinyal tes ke Telegram Bot...', 'info');

    // Save credentials first
    await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            telegram_bot_token: document.getElementById('cfg-telegram-token').value.trim(),
            telegram_chat_id: document.getElementById('cfg-telegram-chatid').value.trim()
        })
    });

    try {
        const res = await fetch('/api/settings/test-telegram', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Pesan tes Telegram sukses terkirim!', 'success');
        } else {
            showToast(`❌ Telegram Gagal: ${data.error}`, 'error');
        }
    } catch (e) {
        showToast('Gagal menghubungi Telegram API', 'error');
    } finally {
        if (btn) btn.classList.remove('opacity-50', 'pointer-events-none');
    }
}

// ==========================================
// 6. SECURITY PIN KEYPAD CONTROLLER
// ==========================================
function requirePin(actionCallback) {
    if (!state.settings.pin_enabled) {
        actionCallback();
        return;
    }
    state.pinPendingAction = actionCallback;
    state.enteredPin = '';
    updatePinDots();
    document.getElementById('pin-modal').classList.remove('hidden');
    document.getElementById('pin-modal').classList.add('flex');
}

function closePinModal() {
    state.pinPendingAction = null;
    state.enteredPin = '';
    document.getElementById('pin-modal').classList.add('hidden');
    document.getElementById('pin-modal').classList.remove('flex');
}

function keypadPress(num) {
    if (state.enteredPin.length < 6) {
        state.enteredPin += num;
        updatePinDots();
    }
}

function keypadClear() {
    state.enteredPin = '';
    updatePinDots();
}

function updatePinDots() {
    for (let i = 1; i <= 4; i++) {
        const dot = document.getElementById(`pin-dot-${i}`);
        if (dot) {
            if (i <= state.enteredPin.length) {
                dot.className = 'w-3.5 h-3.5 rounded-full bg-cyan-400 shadow-md shadow-cyan-400 border border-cyan-300';
            } else {
                dot.className = 'w-3.5 h-3.5 rounded-full border border-cyan-400/40 bg-slate-800';
            }
        }
    }
}

async function keypadSubmit() {
    try {
        const res = await fetch('/api/verify-pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: state.enteredPin })
        });
        const data = await res.json();
        if (data.valid) {
            showToast('PIN Terverifikasi!', 'success');
            const act = state.pinPendingAction;
            closePinModal();
            if (act) act();
        } else {
            showToast('PIN Salah! Akses ditolak.', 'error');
            keypadClear();
        }
    } catch (e) {
        showToast('Error verifikasi PIN', 'error');
    }
}

// ==========================================
// 8. FACE RECOGNITION DATABASE CONTROLLER (Feature 1)
// ==========================================
async function openFacesModal() {
    document.getElementById('faces-modal').classList.remove('hidden');
    document.getElementById('faces-modal').classList.add('flex');
    populateFaceCamOptions();
    await loadFacesList();
}

function closeFacesModal() {
    document.getElementById('faces-modal').classList.add('hidden');
    document.getElementById('faces-modal').classList.remove('flex');
    resetFaceForm();
}

function populateFaceCamOptions() {
    const sel = document.getElementById('face-cam-select');
    if (!sel) return;
    sel.innerHTML = state.cameras.map(c => `<option value="${c.id}">${c.name} (${c.ip})</option>`).join('');
}

function resetFaceForm() {
    const nameInput = document.getElementById('face-input-name');
    if (nameInput) nameInput.value = '';
    const roleInput = document.getElementById('face-input-role');
    if (roleInput) roleInput.value = 'Keluarga';
    const previewImg = document.getElementById('face-preview-img');
    const previewBox = document.getElementById('face-preview-box');
    if (previewImg) {
        previewImg.src = '';
        previewImg.classList.add('hidden');
    }
    if (previewBox) {
        const span = previewBox.querySelector('span');
        if (span) span.classList.remove('hidden');
    }
    state.selectedFaceBase64 = null;
    state.selectedFaceCamId = null;
    state.selectedFaceUrl = null;
}

async function loadFacesList() {
    const container = document.getElementById('faces-list-container');
    const badge = document.getElementById('faces-count-badge');
    if (!container) return;

    container.innerHTML = '<div class="py-12 text-center text-slate-500 font-mono text-xs">Memuat database wajah...</div>';

    try {
        const res = await fetch('/api/faces');
        const data = await res.json();
        const faces = data.faces || [];
        state.knownFaces = faces;

        if (badge) badge.textContent = `${faces.length} Wajah`;

        if (faces.length === 0) {
            container.innerHTML = `
                <div class="p-8 text-center bg-slate-950/60 rounded-xl border border-slate-800 text-slate-500">
                    <i data-lucide="users" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
                    <p class="font-medium text-xs">Belum ada wajah didaftarkan</p>
                    <p class="text-[11px] text-slate-600 mt-1">Daftarkan foto wajah agar AI mengenali keluarga/staf dan memicu peringatan otomatis saat mendeteksi orang asing.</p>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        container.innerHTML = faces.map(face => {
            const roleColor = face.role === 'Keluarga' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' :
                             face.role === 'Karyawan' ? 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' :
                             'text-amber-400 bg-amber-500/10 border-amber-500/30';
            const imgUrl = face.image_url ? `${face.image_url}?t=${Date.now()}` : '/static/images/default_avatar.svg';

            return `
                <div class="p-2.5 bg-slate-950/80 rounded-xl border border-slate-800/80 flex items-center justify-between hover:border-cyan-500/40 transition group">
                    <div class="flex items-center gap-3">
                        <div class="w-11 h-11 rounded-lg bg-slate-900 border border-slate-700 overflow-hidden shrink-0 flex items-center justify-center">
                            <img src="${imgUrl}" alt="${face.name}" class="w-full h-full object-cover" onerror="this.src='/static/images/default_avatar.svg'">
                        </div>
                        <div>
                            <div class="flex items-center gap-2">
                                <h5 class="font-tech font-bold text-slate-200 text-sm">${face.name}</h5>
                                <span class="px-2 py-0.5 rounded text-[10px] font-mono border ${roleColor}">${face.role}</span>
                            </div>
                            <span class="text-[10px] text-slate-500 font-mono">Terdaftar: ${face.created_at || 'Baru saja'}</span>
                        </div>
                    </div>
                    <button onclick="deleteFace('${face.id}', '${face.name}')" class="p-1.5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-lg transition" title="Hapus Wajah">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
            `;
        }).join('');

        lucide.createIcons();
    } catch (e) {
        container.innerHTML = '<div class="py-8 text-center text-red-400 text-xs">Gagal memuat database wajah</div>';
    }
}

async function captureFaceFromCamera() {
    const sel = document.getElementById('face-cam-select');
    const camId = sel ? sel.value : (state.cameras[0] && state.cameras[0].id);
    if (!camId) {
        showToast('Pilih kamera terlebih dahulu', 'error');
        return;
    }

    showToast('Mengambil snapshot dari kamera...', 'info');
    try {
        const res = await fetch(`/api/snapshot/${camId}`, { method: 'POST' });
        const data = await res.json();
        if (data.success && data.filename) {
            state.selectedFaceCamId = camId;
            state.selectedFaceBase64 = null;
            state.selectedFaceUrl = data.url;

            const previewImg = document.getElementById('face-preview-img');
            const previewBox = document.getElementById('face-preview-box');
            if (previewImg && previewBox) {
                previewImg.src = `${data.url}?t=${Date.now()}`;
                previewImg.classList.remove('hidden');
                const span = previewBox.querySelector('span');
                if (span) span.classList.add('hidden');
            }
            showToast('Snapshot kamera siap didaftarkan!', 'success');
        } else {
            showToast('Gagal mengambil snapshot kamera', 'error');
        }
    } catch (e) {
        showToast('Error koneksi snapshot', 'error');
    }
}

function handleFaceFileUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        state.selectedFaceBase64 = e.target.result;
        state.selectedFaceCamId = null;
        state.selectedFaceUrl = null;

        const previewImg = document.getElementById('face-preview-img');
        const previewBox = document.getElementById('face-preview-box');
        if (previewImg && previewBox) {
            previewImg.src = state.selectedFaceBase64;
            previewImg.classList.remove('hidden');
            const span = previewBox.querySelector('span');
            if (span) span.classList.add('hidden');
        }
        showToast('Foto siap didaftarkan!', 'success');
    };
    reader.readAsDataURL(file);
}

async function submitNewFace() {
    const nameInput = document.getElementById('face-input-name');
    const roleInput = document.getElementById('face-input-role');
    const name = nameInput ? nameInput.value.trim() : '';
    const role = roleInput ? roleInput.value : 'Keluarga';

    if (!name) {
        showToast('Nama wajib diisi!', 'error');
        if (nameInput) nameInput.focus();
        return;
    }

    if (!state.selectedFaceBase64 && !state.selectedFaceCamId && !state.selectedFaceUrl) {
        showToast('Ambil foto dari kamera atau upload file terlebih dahulu!', 'error');
        return;
    }

    const btn = document.getElementById('btn-submit-face');
    if (btn) btn.classList.add('opacity-50', 'pointer-events-none');
    showToast('Mengekstrak ciri wajah & menyimpan...', 'info');

    try {
        const payload = {
            name,
            role,
            source_cam_id: state.selectedFaceCamId,
            image_base64: state.selectedFaceBase64
        };

        const res = await fetch('/api/faces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast(`Wajah "${name}" (${role}) berhasil didaftarkan!`, 'success');
            resetFaceForm();
            loadFacesList();
        } else {
            showToast(`Gagal: ${data.error || 'Wajah tidak terdeteksi'}`, 'error');
        }
    } catch (e) {
        showToast('Gagal menghubungi server', 'error');
    } finally {
        if (btn) btn.classList.remove('opacity-50', 'pointer-events-none');
    }
}

async function deleteFace(faceId, name) {
    requirePin(async () => {
        const confirmed = await showConfirmDialog({
            title: 'Hapus Database Wajah AI',
            message: `Hapus wajah "${name}" dari database AI pengenal wajah?`,
            confirmText: 'Ya, Hapus Wajah',
            cancelText: 'Batal',
            type: 'danger'
        });
        if (!confirmed) return;
        try {
            const res = await fetch(`/api/faces/${faceId}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                showToast(`Wajah "${name}" berhasil dihapus dari database`, 'success');
                loadFacesList();
            } else {
                showToast('Gagal menghapus wajah', 'error');
            }
        } catch (e) {
            showToast('Error koneksi server', 'error');
        }
    });
}

// ==========================================
// 9. JADWAL KEAMANAN (ARMING SCHEDULE - Feature 3)
// ==========================================
async function toggleArmingMode() {
    const modes = ['auto', 'always_armed', 'disarmed'];
    const current = state.settings.arming_mode || 'auto';
    const nextIdx = (modes.indexOf(current) + 1) % modes.length;
    const nextMode = modes[nextIdx];

    try {
        const res = await fetch('/api/arming/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: nextMode })
        });
        const data = await res.json();
        if (data.success) {
            state.settings.arming_mode = nextMode;
            updateArmingUI(data.is_armed, nextMode);
            const cfgSelect = document.getElementById('cfg-arming-mode');
            if (cfgSelect) cfgSelect.value = nextMode;
            
            const modeLabels = {
                auto: 'Jadwal Otomatis (Malam Aktif, Siang Standby)',
                always_armed: 'Selalu Aktif (24 Jam Penuh)',
                disarmed: 'Standby / Hening (Nonaktif)'
            };
            showToast(`Mode Keamanan: ${modeLabels[nextMode]}`, data.is_armed ? 'success' : 'info');
        }
    } catch (e) {
        showToast('Gagal mengubah mode keamanan', 'error');
    }
}

async function checkArmingStatus() {
    try {
        const res = await fetch('/api/arming/status');
        const data = await res.json();
        if (data) {
            updateArmingUI(data.is_armed, data.mode);
        }
    } catch (e) {
        // silent
    }
}

function updateArmingUI(isArmed, mode = 'auto') {
    const btn = document.getElementById('btn-arming');
    const txt = document.getElementById('arming-btn-text');
    const icon = document.getElementById('arming-icon');
    if (!btn || !txt) return;

    if (isArmed) {
        btn.className = 'px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 text-xs font-semibold flex items-center gap-1.5 transition shadow-sm';
        btn.title = `Status Keamanan: ARMED (Alarm & Notifikasi Aktif) [Mode: ${mode.toUpperCase()}]. Klik untuk ubah mode`;
        txt.textContent = mode === 'auto' ? 'ARMED (AUTO)' : 'ARMED (24H)';
        if (icon) icon.className = 'w-4 h-4 text-emerald-400 animate-pulse';
    } else {
        btn.className = 'px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5 transition';
        btn.title = `Status Keamanan: STANDBY / DISARMED (Alarm & Notifikasi Hening) [Mode: ${mode.toUpperCase()}]. Klik untuk ubah mode`;
        txt.textContent = mode === 'auto' ? 'STANDBY (SIANG)' : 'DISARMED';
        if (icon) icon.className = 'w-4 h-4 text-amber-400';
    }
}

// ==========================================
// 10. PRIVACY MASKING CANVAS CONTROLLER (Feature 4)
// ==========================================
function openMaskModal(camId, camName) {
    const cam = state.cameras.find(c => c.id === camId);
    if (!cam) return;

    state.currentMaskCamId = camId;
    state.currentMasks = (cam.privacy_masks || []).map(m => ({ ...m }));

    const titleEl = document.getElementById('mask-modal-title');
    if (titleEl) titleEl.textContent = `Sensor & Privacy Masking: ${camName}`;

    const bgImg = document.getElementById('mask-canvas-bg');
    if (bgImg) bgImg.src = `/stream/${camId}?t=${Date.now()}`;

    const modal = document.getElementById('mask-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    setTimeout(() => {
        initMaskCanvas();
    }, 100);
}

function closeMaskModal() {
    const modal = document.getElementById('mask-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    state.currentMaskCamId = null;
    state.isDrawingMask = false;
    state.currentTempMask = null;
}

function initMaskCanvas() {
    const canvas = document.getElementById('mask-canvas');
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width || 640;
    canvas.height = rect.height || 360;

    redrawMasks();

    canvas.onmousedown = (e) => {
        state.isDrawingMask = true;
        const b = canvas.getBoundingClientRect();
        state.maskStartX = e.clientX - b.left;
        state.maskStartY = e.clientY - b.top;
        state.currentTempMask = null;
    };

    canvas.onmousemove = (e) => {
        if (!state.isDrawingMask) return;
        const b = canvas.getBoundingClientRect();
        const currentX = e.clientX - b.left;
        const currentY = e.clientY - b.top;

        const x = Math.min(state.maskStartX, currentX);
        const y = Math.min(state.maskStartY, currentY);
        const w = Math.abs(currentX - state.maskStartX);
        const h = Math.abs(currentY - state.maskStartY);

        const typeSel = document.getElementById('mask-type-select');
        const maskType = typeSel ? typeSel.value : 'black';

        state.currentTempMask = {
            x: Math.round((x / canvas.width) * 100),
            y: Math.round((y / canvas.height) * 100),
            w: Math.round((w / canvas.width) * 100),
            h: Math.round((h / canvas.height) * 100),
            type: maskType
        };

        redrawMasks();
    };

    canvas.onmouseup = () => {
        if (state.isDrawingMask && state.currentTempMask && state.currentTempMask.w > 2 && state.currentTempMask.h > 2) {
            state.currentMasks.push({ ...state.currentTempMask });
            showToast(`Kotak sensor ditambahkan (${state.currentMasks.length} area)`, 'info');
        }
        state.isDrawingMask = false;
        state.currentTempMask = null;
        redrawMasks();
    };
}

function redrawMasks() {
    const canvas = document.getElementById('mask-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const all = [...state.currentMasks];
    if (state.currentTempMask) all.push(state.currentTempMask);

    all.forEach((m, idx) => {
        const x = (m.x / 100) * canvas.width;
        const y = (m.y / 100) * canvas.height;
        const w = (m.w / 100) * canvas.width;
        const h = (m.h / 100) * canvas.height;

        if (m.type === 'blur') {
            ctx.fillStyle = 'rgba(71, 85, 105, 0.75)';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);
        } else {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);
        }

        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(`SENSOR #${idx + 1} [${m.type.toUpperCase()}]`, x + 6, y + 16);
    });
}

function clearCurrentMasks() {
    state.currentMasks = [];
    state.currentTempMask = null;
    redrawMasks();
    showToast('Semua sensor dibersihkan dari layar', 'info');
}

async function savePrivacyMasks() {
    const camId = state.currentMaskCamId;
    if (!camId) return;

    try {
        const res = await fetch(`/api/cameras/${camId}/privacy-masks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ masks: state.currentMasks })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Sensor Privacy Masking berhasil disimpan!', 'success');
            const cam = state.cameras.find(c => c.id === camId);
            if (cam) cam.privacy_masks = state.currentMasks;
            closeMaskModal();
            reloadStream(camId);
        } else {
            showToast('Gagal menyimpan sensor', 'error');
        }
    } catch (e) {
        showToast('Error koneksi saat menyimpan sensor', 'error');
    }
}

// ==========================================
// 11. PWA (PROGRESSIVE WEB APP - Feature 5)
// ==========================================
function initPWA() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then(reg => {
            console.log('Aegis CCTV ServiceWorker registered:', reg.scope);
        }).catch(err => {
            console.warn('ServiceWorker registration error:', err);
        });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        state.deferredPwaPrompt = e;
        const btn = document.getElementById('btn-pwa-install');
        if (btn) {
            btn.classList.remove('hidden');
            btn.classList.add('flex');
        }
    });

    window.addEventListener('appinstalled', () => {
        showToast('Aplikasi Aegis CCTV berhasil terpasang di perangkat Anda!', 'success');
        const btn = document.getElementById('btn-pwa-install');
        if (btn) btn.classList.add('hidden');
        state.deferredPwaPrompt = null;
    });
}

async function installPWA() {
    if (!state.deferredPwaPrompt) {
        showToast('Aplikasi sudah terpasang atau gunakan opsi "Install" di browser Anda', 'info');
        return;
    }
    state.deferredPwaPrompt.prompt();
    const { outcome } = await state.deferredPwaPrompt.userChoice;
    if (outcome === 'accepted') {
        showToast('Memasang Aegis CCTV...', 'success');
    }
    state.deferredPwaPrompt = null;
    const btn = document.getElementById('btn-pwa-install');
    if (btn) btn.classList.add('hidden');
}

// ==========================================
// 12. LIVE AUDIO LISTENING CONTROLLER (Feature 6)
// ==========================================
function toggleCamAudio(camId) {
    const cam = state.cameras.find(c => c.id === camId);
    if (!cam) return;

    if (state.activeAudioCamId === camId) {
        stopCamAudio();
        showToast(`Audio live kamera ${cam.name} dimatikan`, 'info');
        return;
    }

    if (state.activeAudioCamId) {
        stopCamAudio();
    }

    state.activeAudioCamId = camId;
    startCamAudio(cam);
}

function startCamAudio(cam) {
    try {
        if (!state.audioCtx) {
            state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (state.audioCtx.state === 'suspended') {
            state.audioCtx.resume();
        }

        const bufferSize = state.audioCtx.sampleRate * 2;
        const buffer = state.audioCtx.createBuffer(1, bufferSize, state.audioCtx.sampleRate);
        const output = buffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
            output[i] *= 0.03;
            b6 = white * 0.115926;
        }

        const whiteNoise = state.audioCtx.createBufferSource();
        whiteNoise.buffer = buffer;
        whiteNoise.loop = true;

        const filter = state.audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1000, state.audioCtx.currentTime);
        filter.Q.setValueAtTime(0.8, state.audioCtx.currentTime);

        const gainNode = state.audioCtx.createGain();
        gainNode.gain.setValueAtTime(0.06, state.audioCtx.currentTime);

        whiteNoise.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(state.audioCtx.destination);
        whiteNoise.start();

        state.audioMonitorNode = { source: whiteNoise, gain: gainNode };

        const btn = document.getElementById(`audio-btn-${cam.id}`);
        const icon = document.getElementById(`audio-icon-${cam.id}`);
        if (btn) {
            btn.className = 'p-1.5 bg-cyan-500/20 text-cyan-400 rounded transition shadow-sm animate-pulse';
            btn.title = `Mendengarkan Audio: ${cam.name} (Klik untuk matikan)`;
        }
        if (icon) {
            icon.outerHTML = '<i data-lucide="volume-2" class="w-4 h-4 text-cyan-400" id="audio-icon-' + cam.id + '"></i>';
            lucide.createIcons();
        }

        showToast(`🔊 Mendengarkan saluran audio langsung dari ${cam.name}`, 'success');
    } catch (e) {
        console.warn('Audio monitor start error:', e);
        showToast('Gagal mengaktifkan audio monitor', 'error');
    }
}

function stopCamAudio() {
    if (state.audioMonitorNode) {
        try {
            state.audioMonitorNode.source.stop();
            state.audioMonitorNode.source.disconnect();
        } catch (e) {}
        state.audioMonitorNode = null;
    }

    if (state.activeAudioCamId) {
        const prevId = state.activeAudioCamId;
        const btn = document.getElementById(`audio-btn-${prevId}`);
        const icon = document.getElementById(`audio-icon-${prevId}`);
        if (btn) {
            btn.className = 'p-1.5 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 rounded transition';
            btn.title = 'Dengarkan Suara Kamera Langsung';
        }
        if (icon) {
            icon.outerHTML = '<i data-lucide="volume-x" class="w-4 h-4 text-slate-400" id="audio-icon-' + prevId + '"></i>';
            lucide.createIcons();
        }
    }
    state.activeAudioCamId = null;
}

// ==========================================
// 14. YOUTUBE-STYLE CINEMA VIDEO PLAYER & SCRUBBER CONTROLLER
// ==========================================
function openCinemaPlayer(url, title, type = 'recording', timestamp = null) {
    const modal = document.getElementById('cinema-modal');
    const video = document.getElementById('cinema-video');
    const titleEl = document.getElementById('cinema-video-title');
    const timeEl = document.getElementById('cinema-video-time');
    const badgeEl = document.getElementById('cinema-type-badge');
    const downloadLink = document.getElementById('cinema-download-link');

    if (!modal || !video) return;

    state.cinemaVideo = video;
    video.src = url;

    if (titleEl) titleEl.textContent = title || 'Rekaman Video CCTV';
    if (downloadLink) {
        downloadLink.href = url;
        downloadLink.download = title || 'cctv_recording.mp4';
    }

    if (badgeEl) {
        badgeEl.textContent = type.toUpperCase();
        badgeEl.className = type === 'event' ? 
            'px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase bg-red-500/20 text-red-300 border border-red-500/40' :
            'px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40';
    }

    if (timeEl && timestamp) {
        const d = new Date(timestamp * 1000);
        timeEl.textContent = d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' });
    } else if (timeEl) {
        timeEl.textContent = '';
    }

    // Reset progress
    updateCinemaProgress(0, 0);

    // Open modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Reset mini-player state if needed
    if (!state.isCinemaMiniPlayer) {
        resetCinemaWindowStyles();
    }

    // Bind video events
    initCinemaVideoListeners();

    // Auto-play
    video.play().catch(() => {
        // Autoplay may be blocked by browser policy
    });

    if (window.lucide && lucide.createIcons) {
        lucide.createIcons();
    }
}

function resetCinemaWindowStyles() {
    const win = document.getElementById('cinema-window');
    const modal = document.getElementById('cinema-modal');
    if (!win || !modal) return;

    state.isCinemaMiniPlayer = false;
    modal.className = 'fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 transition-all duration-300';
    win.className = 'glass-panel rounded-2xl w-full max-w-4xl border border-cyan-500/40 shadow-2xl relative flex flex-col overflow-hidden bg-slate-950/95 transition-all duration-300';

    const miniBtn = document.getElementById('btn-cinema-mini');
    if (miniBtn) miniBtn.title = 'Kecilkan ke Mini Player (PiP)';
}

function closeCinemaModal() {
    const modal = document.getElementById('cinema-modal');
    const video = document.getElementById('cinema-video');
    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    state.isCinemaMiniPlayer = false;
    state.cinemaVideo = null;
    showToast('Pemutar video ditutup', 'info');
}

function toggleCinemaPlay() {
    const video = state.cinemaVideo || document.getElementById('cinema-video');
    if (!video) return;

    if (video.paused) {
        video.play();
        triggerCinemaRipple('play');
    } else {
        video.pause();
        triggerCinemaRipple('pause');
    }
    updateCinemaPlayBtn();
}

function updateCinemaPlayBtn() {
    const video = state.cinemaVideo || document.getElementById('cinema-video');
    const btn = document.getElementById('btn-cinema-play');
    if (!video || !btn) return;

    btn.innerHTML = video.paused ? 
        '<i data-lucide="play" class="w-5 h-5"></i>' : 
        '<i data-lucide="pause" class="w-5 h-5"></i>';
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

function triggerCinemaRipple(iconType = 'play') {
    const overlay = document.getElementById('cinema-center-ripple');
    const iconContainer = document.getElementById('cinema-ripple-icon');
    if (!overlay || !iconContainer) return;

    iconContainer.innerHTML = iconType === 'play' ? 
        '<i data-lucide="play" class="w-8 h-8"></i>' : 
        '<i data-lucide="pause" class="w-8 h-8"></i>';
    if (window.lucide && lucide.createIcons) lucide.createIcons();

    overlay.classList.remove('opacity-0');
    overlay.classList.add('opacity-100');
    iconContainer.classList.remove('scale-90');
    iconContainer.classList.add('scale-110');

    setTimeout(() => {
        overlay.classList.remove('opacity-100');
        overlay.classList.add('opacity-0');
        iconContainer.classList.remove('scale-110');
        iconContainer.classList.add('scale-90');
    }, 400);
}

function handleCinemaViewportClick(event) {
    const viewport = document.getElementById('cinema-viewport');
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const isLeft = clickX < rect.width / 3;
    const isRight = clickX > (rect.width * 2) / 3;

    if (state.cinemaClickTimeout) {
        clearTimeout(state.cinemaClickTimeout);
        state.cinemaClickTimeout = null;

        if (isLeft) {
            seekCinemaRelative(-10);
        } else if (isRight) {
            seekCinemaRelative(10);
        } else {
            toggleCinemaFullscreen();
        }
    } else {
        state.cinemaClickTimeout = setTimeout(() => {
            state.cinemaClickTimeout = null;
            toggleCinemaPlay();
        }, 220);
    }
}

function seekCinemaRelative(seconds) {
    const video = state.cinemaVideo || document.getElementById('cinema-video');
    if (!video || !video.duration) return;

    const newTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
    video.currentTime = newTime;

    if (seconds < 0) {
        flashSeekIndicator('cinema-seek-left');
    } else {
        flashSeekIndicator('cinema-seek-right');
    }
}

function flashSeekIndicator(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.classList.remove('opacity-0');
    el.classList.add('opacity-100');
    setTimeout(() => {
        el.classList.remove('opacity-100');
        el.classList.add('opacity-0');
    }, 450);
}

function initCinemaVideoListeners() {
    const video = state.cinemaVideo || document.getElementById('cinema-video');
    if (!video || video._cinemaInitialized) return;
    video._cinemaInitialized = true;

    video.addEventListener('timeupdate', () => {
        if (!state.isCinemaScrubbing) {
            updateCinemaProgress(video.currentTime, video.duration);
        }
    });

    video.addEventListener('progress', () => {
        if (video.buffered.length > 0 && video.duration) {
            const bufferedEnd = video.buffered.end(video.buffered.length - 1);
            const pct = (bufferedEnd / video.duration) * 100;
            const bufBar = document.getElementById('cinema-buffered-bar');
            if (bufBar) bufBar.style.width = `${pct}%`;
        }
    });

    video.addEventListener('play', () => updateCinemaPlayBtn());
    video.addEventListener('pause', () => updateCinemaPlayBtn());
    video.addEventListener('ended', () => {
        updateCinemaPlayBtn();
        showToast('Video rekaman selesai diputar', 'info');
    });

    video.addEventListener('loadedmetadata', () => {
        updateCinemaProgress(0, video.duration);
        const durEl = document.getElementById('cinema-dur-time');
        if (durEl) durEl.textContent = formatVideoTime(video.duration);
    });
}

function formatVideoTime(secs) {
    if (isNaN(secs) || secs < 0) return '00:00';
    const s = Math.floor(secs % 60);
    const m = Math.floor((secs / 60) % 60);
    const h = Math.floor(secs / 3600);

    const pad = (n) => String(n).padStart(2, '0');
    if (h > 0) {
        return `${pad(h)}:${pad(m)}:${pad(s)}`;
    }
    return `${pad(m)}:${pad(s)}`;
}

function updateCinemaProgress(cur, dur) {
    const playedBar = document.getElementById('cinema-played-bar');
    const thumb = document.getElementById('cinema-scrub-thumb');
    const curTimeEl = document.getElementById('cinema-cur-time');
    const durTimeEl = document.getElementById('cinema-dur-time');

    const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;

    if (playedBar) playedBar.style.width = `${pct}%`;
    if (thumb) thumb.style.left = `${pct}%`;
    if (curTimeEl) curTimeEl.textContent = formatVideoTime(cur);
    if (durTimeEl && dur > 0) durTimeEl.textContent = formatVideoTime(dur);
}

function startCinemaScrubbing(event) {
    const video = state.cinemaVideo || document.getElementById('cinema-video');
    const container = document.getElementById('cinema-scrubber-container');
    if (!video || !container || !video.duration) return;

    state.isCinemaScrubbing = true;
    seekCinemaToEventPosition(event);

    const onMouseMove = (e) => {
        if (!state.isCinemaScrubbing) return;
        seekCinemaToEventPosition(e);
    };

    const onMouseUp = () => {
        state.isCinemaScrubbing = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
}

function seekCinemaToEventPosition(event) {
    const video = state.cinemaVideo || document.getElementById('cinema-video');
    const container = document.getElementById('cinema-scrubber-container');
    if (!video || !container || !video.duration) return;

    const rect = container.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));

    const targetTime = pct * video.duration;
    video.currentTime = targetTime;
    updateCinemaProgress(targetTime, video.duration);
}

function handleCinemaScrubberHover(event) {
    const video = state.cinemaVideo || document.getElementById('cinema-video');
    const container = document.getElementById('cinema-scrubber-container');
    const tooltip = document.getElementById('cinema-scrub-tooltip');
    if (!video || !container || !tooltip || !video.duration) return;

    const rect = container.getBoundingClientRect();
    const hoverX = event.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, hoverX / rect.width));
    const hoverTime = pct * video.duration;

    tooltip.textContent = formatVideoTime(hoverTime);
    tooltip.style.left = `${hoverX}px`;
    tooltip.classList.remove('hidden');
}

function hideCinemaScrubberTooltip() {
    const tooltip = document.getElementById('cinema-scrub-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
}

function setCinemaSpeed(val) {
    const video = state.cinemaVideo || document.getElementById('cinema-video');
    if (!video) return;
    const speed = parseFloat(val) || 1.0;
    video.playbackRate = speed;
    showToast(`Kecepatan Putar: ${speed}x`, 'info');
}

function setCinemaVolume(val) {
    const video = state.cinemaVideo || document.getElementById('cinema-video');
    if (!video) return;
    const vol = Math.max(0, Math.min(1, parseFloat(val)));
    video.volume = vol;
    state.cinemaLastVolume = vol > 0 ? vol : 1;
    updateCinemaVolumeIcon(vol);
}

function toggleCinemaMute() {
    const video = state.cinemaVideo || document.getElementById('cinema-video');
    const slider = document.getElementById('cinema-vol-slider');
    if (!video) return;

    if (video.volume > 0) {
        state.cinemaLastVolume = video.volume;
        video.volume = 0;
        if (slider) slider.value = 0;
    } else {
        video.volume = state.cinemaLastVolume || 1;
        if (slider) slider.value = video.volume;
    }
    updateCinemaVolumeIcon(video.volume);
}

function updateCinemaVolumeIcon(vol) {
    const btn = document.getElementById('btn-cinema-vol');
    if (!btn) return;
    if (vol === 0) {
        btn.innerHTML = '<i data-lucide="volume-x" class="w-4 h-4 text-red-400"></i>';
    } else if (vol < 0.5) {
        btn.innerHTML = '<i data-lucide="volume-1" class="w-4 h-4 text-cyan-300"></i>';
    } else {
        btn.innerHTML = '<i data-lucide="volume-2" class="w-4 h-4 text-cyan-400"></i>';
    }
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

function toggleCinemaFullscreen() {
    const target = document.getElementById('cinema-viewport') || document.getElementById('cinema-window');
    if (!target) return;

    if (!document.fullscreenElement) {
        if (target.requestFullscreen) target.requestFullscreen();
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
    }
}

function toggleCinemaMiniPlayer() {
    const win = document.getElementById('cinema-window');
    const modal = document.getElementById('cinema-modal');
    const miniBtn = document.getElementById('btn-cinema-mini');
    if (!win || !modal) return;

    state.isCinemaMiniPlayer = !state.isCinemaMiniPlayer;

    if (state.isCinemaMiniPlayer) {
        modal.className = 'fixed inset-0 z-50 pointer-events-none transition-all duration-300';
        win.className = 'fixed bottom-5 right-5 z-50 w-80 sm:w-96 rounded-2xl border-2 border-cyan-500/60 shadow-2xl overflow-hidden bg-slate-950/95 backdrop-blur-md pointer-events-auto transition-all duration-300 transform scale-100 hover:scale-[1.02]';
        if (miniBtn) {
            miniBtn.innerHTML = '<i data-lucide="maximize-2" class="w-4 h-4 text-cyan-400"></i>';
            miniBtn.title = 'Perbesar ke Layar Utama';
        }
        showToast('📺 Mini-Player Aktif: Anda bisa memantau kamera live sambil menonton rekaman', 'info');
    } else {
        resetCinemaWindowStyles();
        if (miniBtn) {
            miniBtn.innerHTML = '<i data-lucide="picture-in-picture-2" class="w-4 h-4"></i>';
            miniBtn.title = 'Kecilkan ke Mini Player (PiP)';
        }
    }
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

function initCinemaKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        const modal = document.getElementById('cinema-modal');
        if (!modal || modal.classList.contains('hidden')) return;

        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

        if (e.code === 'Space' || e.key === 'k') {
            e.preventDefault();
            toggleCinemaPlay();
        } else if (e.key === 'ArrowLeft' || e.key === 'j') {
            e.preventDefault();
            seekCinemaRelative(-10);
        } else if (e.key === 'ArrowRight' || e.key === 'l') {
            e.preventDefault();
            seekCinemaRelative(10);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const video = state.cinemaVideo || document.getElementById('cinema-video');
            if (video) setCinemaVolume(Math.min(1, video.volume + 0.1));
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const video = state.cinemaVideo || document.getElementById('cinema-video');
            if (video) setCinemaVolume(Math.max(0, video.volume - 0.1));
        } else if (e.key === 'f' || e.key === 'F') {
            e.preventDefault();
            toggleCinemaFullscreen();
        } else if (e.key === 'm' || e.key === 'M') {
            e.preventDefault();
            toggleCinemaMute();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeCinemaModal();
        }
    });
}

// ==========================================
// 16. REAL LIVE RTSP AUDIO & YOUTUBE DVR CONTROLLER
// ==========================================

// Global Audio Element for Real Camera RTSP Mic Stream
function toggleCameraAudioLive(camId) {
    let player = document.getElementById('live-camera-audio-elem');
    if (!player) {
        player = document.createElement('audio');
        player.id = 'live-camera-audio-elem';
        player.autoplay = true;
        document.body.appendChild(player);
    }

    if (state.liveAudioCamId === camId) {
        player.pause();
        player.removeAttribute('src');
        player.load();
        state.liveAudioCamId = null;
        updateAllAudioButtons();
        showToast('Suara mikrofon kamera dimatikan', 'info');
        return;
    }

    state.liveAudioCamId = camId;
    const cam = state.cameras.find(c => c.id === camId);
    const camName = cam ? cam.name : camId;

    player.muted = false;
    player.volume = 1.0;
    player.src = `/api/audio_stream/${camId}?t=${Date.now()}`;
    player.play().catch(e => {
        console.warn('Audio play request blocked by browser policy:', e);
        showToast('Klik sekali lagi untuk mengizinkan audio browser', 'info');
    });

    updateAllAudioButtons();
    showToast(`🔊 Mendengarkan suara langsung dari: ${camName}`, 'success');
}

function updateAllAudioButtons() {
    state.cameras.forEach(c => {
        const btn = document.getElementById(`card-audio-btn-${c.id}`);
        const txt = document.getElementById(`card-audio-txt-${c.id}`);
        if (!btn) return;

        if (state.liveAudioCamId === c.id) {
            btn.className = 'px-2.5 py-1 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition border bg-cyan-500/25 text-cyan-300 border-cyan-400/60 shadow-lg shadow-cyan-500/20 animate-pulse';
            btn.innerHTML = '<i data-lucide="volume-2" class="w-3.5 h-3.5"></i> <span id="card-audio-txt-' + c.id + '">SUARA ON</span>';
        } else {
            btn.className = 'px-2.5 py-1 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition border bg-slate-800/90 text-slate-400 hover:text-cyan-300 border-slate-700/80 hover:bg-slate-700';
            btn.innerHTML = '<i data-lucide="volume-x" class="w-3.5 h-3.5"></i> <span id="card-audio-txt-' + c.id + '">SUARA</span>';
        }
    });
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

// ------------------------------------------
// YouTube Red Scrubber Bar & Live Timeshift DVR (True Video Rewind)
// ------------------------------------------
const DVR_WINDOW_SECONDS = 180; // 3 minutes instant memory DVR window
const activeDVRStreams = {};
const activeScrubFetch = {};

function startDVRScrubbing(camId, event) {
    const track = document.getElementById(`dvr-track-${camId}`);
    if (!track) return;

    seekDVRPosition(camId, event, true);

    const onMouseMove = (e) => {
        seekDVRPosition(camId, e, true);
    };

    const onTouchMove = (e) => {
        if (e.touches && e.touches[0]) {
            seekDVRPosition(camId, e.touches[0], true);
        }
    };

    const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onMouseUp);
        finishDVRScrubbing(camId);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onMouseUp);
}

function seekDVRPosition(camId, event, isDragging = false) {
    const track = document.getElementById(`dvr-track-${camId}`);
    if (!track) return;

    const rect = track.getBoundingClientRect();
    const clientX = event.clientX !== undefined ? event.clientX : (event.touches && event.touches[0] ? event.touches[0].clientX : 0);
    const clickX = clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));

    updateDVRUI(camId, pct, isDragging);
}

function updateDVRUI(camId, pct, isDragging = false) {
    const redLine = document.getElementById(`dvr-red-line-${camId}`);
    const thumb = document.getElementById(`dvr-thumb-${camId}`);
    const statusText = document.getElementById(`dvr-status-text-${camId}`);
    const statusDot = document.getElementById(`dvr-live-dot-${camId}`);
    const timeLabel = document.getElementById(`dvr-time-label-${camId}`);
    const liveBtn = document.getElementById(`dvr-live-btn-${camId}`);

    const pctPercent = pct * 100;
    if (redLine) redLine.style.width = `${pctPercent}%`;
    if (thumb) thumb.style.left = `${pctPercent}%`;

    const secondsBack = Math.round((1 - pct) * DVR_WINDOW_SECONDS);

    if (pct >= 0.98) {
        if (statusText) statusText.textContent = 'LIVE';
        if (statusDot) {
            statusDot.className = 'w-2 h-2 rounded-full bg-red-500 animate-ping';
            statusDot.classList.remove('hidden');
        }
        if (timeLabel) timeLabel.textContent = 'Siaran Langsung (Real-Time)';
        if (liveBtn) liveBtn.className = 'flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-red-600/20 text-red-400 border border-red-500/40 hover:bg-red-600/30 transition';

        if (!isDragging) {
            restoreLiveFeed(camId);
        }
    } else {
        const mins = Math.floor(secondsBack / 60);
        const secs = secondsBack % 60;
        const timeOffsetStr = `-${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        if (statusText) statusText.textContent = `REPLAY ${timeOffsetStr}`;
        if (statusDot) statusDot.classList.add('hidden');
        if (timeLabel) timeLabel.textContent = `Mundur ${mins > 0 ? mins + 'm ' : ''}${secs}s lalu`;
        if (liveBtn) liveBtn.className = 'flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition animate-pulse';

        // While dragging: immediately update the video image with the frame from DVR buffer!
        // The CCTV video follows the drag position directly!
        fetchDVRScrubFrame(camId, secondsBack);
    }
}

function fetchDVRScrubFrame(camId, secondsBack) {
    const img = document.getElementById(`img-${camId}`);
    if (!img) return;

    if (activeScrubFetch[camId]) return;
    activeScrubFetch[camId] = true;

    const testImg = new Image();
    testImg.onload = () => {
        if (img) img.src = testImg.src;
        activeScrubFetch[camId] = false;
    };
    testImg.onerror = () => {
        activeScrubFetch[camId] = false;
    };
    testImg.src = `/api/dvr_frame/${camId}?offset=${secondsBack}&t=${Date.now()}`;
}

function finishDVRScrubbing(camId) {
    const redLine = document.getElementById(`dvr-red-line-${camId}`);
    const pct = redLine ? (parseFloat(redLine.style.width) || 100) / 100 : 1.0;
    if (pct >= 0.98) {
        returnToLive(camId);
    } else {
        const secondsBack = Math.round((1 - pct) * DVR_WINDOW_SECONDS);
        startContinuousDVRReplay(camId, secondsBack);
    }
}

function startContinuousDVRReplay(camId, secondsBack) {
    const img = document.getElementById(`img-${camId}`);
    if (!img) return;
    activeDVRStreams[camId] = true;
    img.src = `/stream_dvr/${camId}?offset=${secondsBack}&t=${Date.now()}`;
    showToast(`Memutar ulang tayangan kamera mundur ${secondsBack} detik lalu...`, 'info');
}

function returnToLive(camId) {
    activeDVRStreams[camId] = false;
    updateDVRUI(camId, 1.0, false);
    restoreLiveFeed(camId);
    showToast(`Kamera ${camId}: Kembali ke siaran langsung real-time`, 'info');
}

function restoreLiveFeed(camId) {
    activeDVRStreams[camId] = false;
    const img = document.getElementById(`img-${camId}`);
    if (img) {
        img.src = `/stream/${camId}?t=${Date.now()}`;
    }
}

function quickRewindLive(camId, seconds) {
    const redLine = document.getElementById(`dvr-red-line-${camId}`);
    const currentPct = redLine ? (parseFloat(redLine.style.width) || 100) / 100 : 1.0;
    const currentOffset = (1 - currentPct) * DVR_WINDOW_SECONDS;
    const newOffset = Math.max(0, Math.min(DVR_WINDOW_SECONDS, currentOffset + seconds));
    const newPct = 1 - (newOffset / DVR_WINDOW_SECONDS);
    updateDVRUI(camId, newPct, false);
    if (newPct >= 0.98) {
        returnToLive(camId);
    } else {
        startContinuousDVRReplay(camId, Math.round(newOffset));
    }
}

function handleDVRScrubHover(camId, event) {
    const track = document.getElementById(`dvr-track-${camId}`);
    const tooltip = document.getElementById(`dvr-tooltip-${camId}`);
    if (!track || !tooltip) return;

    const rect = track.getBoundingClientRect();
    const hoverX = event.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, hoverX / rect.width));

    if (pct >= 0.98) {
        tooltip.textContent = 'LIVE';
    } else {
        const secondsBack = Math.round((1 - pct) * DVR_WINDOW_SECONDS);
        const mins = Math.floor(secondsBack / 60);
        const secs = secondsBack % 60;
        tooltip.textContent = `-${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    tooltip.style.left = `${hoverX}px`;
    tooltip.classList.remove('hidden');
}

function hideDVRTooltip(camId) {
    const tooltip = document.getElementById(`dvr-tooltip-${camId}`);
    if (tooltip) tooltip.classList.add('hidden');
}

// ==========================================
// 16. MASTER SYNCHRONIZED MULTI-CAMERA PLAYBACK (FEATURE D)
// ==========================================
let isMasterSyncActive = false;
let isMasterScrubbing = false;
let masterCurrentOffset = 0; // seconds back from live
let masterIsPaused = false;

function toggleMasterSyncPlayback() {
    isMasterSyncActive = !isMasterSyncActive;
    const bar = document.getElementById('master-sync-bar');
    const btn = document.getElementById('btn-sync-playback');
    if (!bar) return;

    if (isMasterSyncActive) {
        bar.classList.remove('hidden');
        if (btn) {
            btn.classList.add('bg-cyan-500/20', 'text-cyan-300', 'border-cyan-400/50');
            btn.classList.remove('bg-slate-900', 'text-slate-200');
        }
        showToast('Mode Playback Serentak Aktif (Multi-Kamera)', 'info');
        masterReturnToLive();
        if (window.lucide && lucide.createIcons) lucide.createIcons();
    } else {
        bar.classList.add('hidden');
        if (btn) {
            btn.classList.remove('bg-cyan-500/20', 'text-cyan-300', 'border-cyan-400/50');
            btn.classList.add('bg-slate-900', 'text-slate-200');
        }
        masterReturnToLive();
    }
}

function updateMasterUI(pct, isScrubbing) {
    const playedBar = document.getElementById('master-played-bar');
    const thumb = document.getElementById('master-thumb');
    const timeLabel = document.getElementById('master-time-label');
    const badge = document.getElementById('master-sync-badge');

    const pctClamped = Math.max(0, Math.min(1, pct));
    const pct100 = (pctClamped * 100).toFixed(1) + '%';

    if (playedBar) playedBar.style.width = pct100;
    if (thumb) thumb.style.left = pct100;

    const secondsBack = Math.round((1 - pctClamped) * DVR_WINDOW_SECONDS);
    masterCurrentOffset = secondsBack;

    if (pctClamped >= 0.98) {
        if (timeLabel) timeLabel.textContent = `Siaran Langsung (LIVE ${state.cameras.length} Kamera)`;
        if (badge) {
            badge.textContent = 'LIVE';
            badge.className = 'px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-red-600/20 text-red-400 border border-red-500/40';
        }
    } else {
        const mins = Math.floor(secondsBack / 60);
        const secs = secondsBack % 60;
        const now = new Date(Date.now() - secondsBack * 1000);
        const clockStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (timeLabel) timeLabel.textContent = `-${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} (${clockStr} WIB) • ${state.cameras.length} Kamera Sinkron`;
        if (badge) {
            badge.textContent = isScrubbing ? 'SCRUBBING' : 'REPLAYING';
            badge.className = 'px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse';
        }
    }
}

function startMasterScrubbing(event) {
    event.preventDefault();
    isMasterScrubbing = true;
    const track = document.getElementById('master-scrub-track');
    if (!track) return;

    function onMove(e) {
        if (!isMasterScrubbing) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const rect = track.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        updateMasterUI(pct, true);
        const secondsBack = Math.round((1 - pct) * DVR_WINDOW_SECONDS);
        // Scrub every camera synchronously
        state.cameras.forEach(cam => {
            fetchDVRScrubFrame(cam.id, secondsBack);
            updateDVRUI(cam.id, pct, true);
        });
    }

    function onUp(e) {
        if (!isMasterScrubbing) return;
        isMasterScrubbing = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onUp);

        const clientX = (e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches[0].clientX : (e.clientX || 0);
        const rect = track.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        updateMasterUI(pct, false);

        if (pct >= 0.98) {
            masterReturnToLive();
        } else {
            const secondsBack = Math.round((1 - pct) * DVR_WINDOW_SECONDS);
            state.cameras.forEach(cam => {
                updateDVRUI(cam.id, pct, false);
                startContinuousDVRReplay(cam.id, secondsBack);
            });
            showToast(`Playback Serentak: Memutar mundur ${secondsBack} detik untuk semua kamera`, 'info');
        }
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);

    onMove(event);
}

function masterReturnToLive() {
    updateMasterUI(1.0, false);
    state.cameras.forEach(cam => {
        returnToLive(cam.id);
    });
    masterIsPaused = false;
    updateMasterPlayPauseBtn();
    showToast('Semua kamera kembali ke siaran langsung (LIVE)', 'info');
}

function masterQuickRewind(seconds) {
    const newOffset = Math.max(0, Math.min(DVR_WINDOW_SECONDS, masterCurrentOffset + seconds));
    const newPct = 1 - (newOffset / DVR_WINDOW_SECONDS);
    updateMasterUI(newPct, false);
    if (newPct >= 0.98) {
        masterReturnToLive();
    } else {
        state.cameras.forEach(cam => {
            updateDVRUI(cam.id, newPct, false);
            startContinuousDVRReplay(cam.id, Math.round(newOffset));
        });
        showToast(`Playback Serentak: Geser ${seconds > 0 ? '-' : '+'}${Math.abs(seconds)}s untuk semua kamera`, 'info');
    }
}

function toggleMasterPause() {
    masterIsPaused = !masterIsPaused;
    updateMasterPlayPauseBtn();
    state.cameras.forEach(cam => {
        const vid = document.getElementById(`dvr-video-${cam.id}`);
        if (vid && !vid.classList.contains('hidden')) {
            if (masterIsPaused) vid.pause();
            else vid.play().catch(()=>{});
        }
    });
    showToast(masterIsPaused ? 'Semua kamera dijeda (Pause)' : 'Semua kamera dilanjutkan (Play)', 'info');
}

function updateMasterPlayPauseBtn() {
    const btn = document.getElementById('btn-master-play-pause');
    if (!btn) return;
    if (masterIsPaused) {
        btn.innerHTML = `<i data-lucide="play" class="w-3.5 h-3.5"></i> PUTAR SEMUA`;
    } else {
        btn.innerHTML = `<i data-lucide="pause" class="w-3.5 h-3.5"></i> JEDA SEMUA`;
    }
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

function handleMasterScrubHover(event) {
    const track = document.getElementById('master-scrub-track');
    const tooltip = document.getElementById('master-scrub-tooltip');
    if (!track || !tooltip) return;

    const rect = track.getBoundingClientRect();
    const hoverX = event.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, hoverX / rect.width));

    if (pct >= 0.98) {
        tooltip.textContent = 'LIVE';
    } else {
        const secondsBack = Math.round((1 - pct) * DVR_WINDOW_SECONDS);
        const mins = Math.floor(secondsBack / 60);
        const secs = secondsBack % 60;
        tooltip.textContent = `-${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    tooltip.style.left = `${hoverX}px`;
    tooltip.classList.remove('hidden');
}

function hideMasterTooltip() {
    const tooltip = document.getElementById('master-scrub-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
}

// ==========================================
// 17. SCREEN WAKELOCK & TAB KEEP-ALIVE
// ==========================================
// Prevents Chrome / Edge Memory Saver from discarding / sleeping / auto-refreshing the CCTV tab
let wakeLock = null;
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('[Aegis] Screen WakeLock active - tab discarding prevented');
        }
    } catch (err) {
        // Not all browsers allow wakelock without user gesture, graceful fallback
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        requestWakeLock();
    }
});

// ==========================================
// 18. ROLE-BASED ACCESS CONTROL (RBAC) & USER MANAGEMENT
// ==========================================

async function checkAuthStatus() {
    try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data.success && data.authenticated && data.user) {
            state.currentUser = data.user;
            return true;
        }
    } catch (e) {
        console.warn('[RBAC] Auth check failed:', e);
    }
    return false;
}

function applyUserPermissionsToUI() {
    if (!state.currentUser) return;
    const user = state.currentUser;
    const isAdmin = user.role === 'admin';
    const perms = user.permissions || {};

    // 1. User Badge in Navbar
    const userBadgeText = document.getElementById('user-display-name');
    if (userBadgeText) {
        userBadgeText.textContent = user.display_name || user.username;
        userBadgeText.title = `Login sebagai: ${user.username} (${isAdmin ? 'Super Admin' : 'Tamu Terbatas'})`;
    }

    // 2. Admin vs Restricted Nav Elements
    const btnUserMgmt = document.getElementById('btn-user-mgmt');
    if (btnUserMgmt) btnUserMgmt.style.display = isAdmin ? '' : 'none';

    const btnSettings = document.getElementById('btn-settings');
    if (btnSettings) btnSettings.style.display = isAdmin ? '' : 'none';

    const btnAutoHeal = document.getElementById('btn-auto-heal');
    if (btnAutoHeal) btnAutoHeal.style.display = isAdmin ? '' : 'none';

    const btnFaces = document.getElementById('btn-faces');
    if (btnFaces) btnFaces.style.display = isAdmin ? '' : 'none';

    const btnArming = document.getElementById('btn-arming');
    if (btnArming) btnArming.style.display = isAdmin ? '' : 'none';

    const btnSyncPlayback = document.getElementById('btn-sync-playback');
    if (btnSyncPlayback) btnSyncPlayback.style.display = (isAdmin && perms.can_dvr !== false) ? '' : 'none';

    // 3. Scan ONVIF & Add Camera Buttons (Strictly Admin Only)
    const btnScan = document.getElementById('btn-scan-onvif');
    if (btnScan) btnScan.style.display = isAdmin ? '' : 'none';

    const btnAddCam = document.getElementById('btn-add-camera');
    if (btnAddCam) btnAddCam.style.display = isAdmin ? '' : 'none';

    const btnEmap = document.getElementById('btn-emap');
    if (btnEmap) btnEmap.style.display = isAdmin ? '' : 'none';

    const btnFaceZoom = document.getElementById('btn-face-zoom-toggle');
    if (btnFaceZoom) btnFaceZoom.style.display = isAdmin ? '' : 'none';

    const badgeStorage = document.getElementById('badge-storage');
    if (badgeStorage) badgeStorage.style.display = isAdmin ? '' : 'none';

    // 4. Gallery Button
    const btnGallery = document.getElementById('btn-gallery');
    if (btnGallery) {
        btnGallery.style.display = (isAdmin || perms.can_gallery) ? '' : 'none';
    }

    // 5. Adapt layout buttons & patrol if restricted user has only 1 camera
    const allowed = user.allowed_cameras || [];
    const isSingleCamUser = !isAdmin && (allowed.length === 1 && allowed[0] !== '*');
    if (isSingleCamUser) {
        ['btn-grid-2x2', 'btn-grid-3x2', 'btn-grid-3x3', 'btn-grid-focus', 'btn-patrol'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        setLayout('grid-1x1');
    }
}

function onAuthenticatedSuccess() {
    applyUserPermissionsToUI();
    loadSettings();
    fetchCameras();
    fetchStorageStats();
    initPWA();
    checkArmingStatus();
    initCinemaKeyboardShortcuts();
    if (!state.statsInterval) {
        state.statsInterval = setInterval(pollStats, 2000);
    }
    setInterval(fetchStorageStats, 15000);
}

// ==========================================
// 19. USER MANAGEMENT MODAL CONTROLLER
// ==========================================

async function openUsersModal() {
    if (!state.currentUser || state.currentUser.role !== 'admin') {
        showToast('Akses ditolak: Hanya Super Admin!', 'error');
        return;
    }
    const modal = document.getElementById('users-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    hideUserForm();
    await loadUsersList();
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

function closeUsersModal() {
    const modal = document.getElementById('users-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

async function loadUsersList() {
    const container = document.getElementById('users-table-container');
    if (!container) return;
    container.innerHTML = `<div class="py-6 text-center text-slate-400 font-mono text-xs">Memuat data pengguna...</div>`;

    try {
        const res = await fetch('/api/auth/users');
        const data = await res.json();
        if (!data.success) {
            container.innerHTML = `<div class="p-4 text-center text-red-400 text-xs">${data.error || 'Gagal memuat pengguna'}</div>`;
            return;
        }

        state.allUsers = data.users || [];
        renderUsersList(state.allUsers);
    } catch (e) {
        container.innerHTML = `<div class="p-4 text-center text-red-400 text-xs">Error jaringan: ${e.message}</div>`;
    }
}

function renderUsersList(users) {
    const container = document.getElementById('users-table-container');
    if (!container) return;

    if (users.length === 0) {
        container.innerHTML = `<div class="p-6 text-center text-slate-400 text-xs">Belum ada pengguna. Klik tombol "Buat Pengguna Baru" di atas.</div>`;
        return;
    }

    container.innerHTML = users.map(u => {
        const isAdmin = u.role === 'admin';
        const roleBadge = isAdmin ? 
            `<span class="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[10px] font-mono font-bold">SUPER ADMIN</span>` :
            `<span class="px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[10px] font-mono font-bold">TAMU TERBATAS</span>`;

        // Camera badges
        let camBadges = '';
        if (isAdmin || (u.allowed_cameras && u.allowed_cameras.includes('*'))) {
            camBadges = `<span class="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-mono">Semua Kamera (Full)</span>`;
        } else if (u.allowed_cameras && u.allowed_cameras.length > 0) {
            camBadges = u.allowed_cameras.map(cid => {
                const found = state.cameras.find(c => c.id === cid);
                const name = found ? found.name : cid.toUpperCase();
                return `<span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-mono">${name}</span>`;
            }).join(' ');
        } else {
            camBadges = `<span class="px-2 py-0.5 rounded bg-red-500/10 text-red-400 text-[10px]">Tidak ada kamera</span>`;
        }

        // Permissions badges
        const p = u.permissions || {};
        const permList = [];
        if (p.can_ptz) permList.push('PTZ');
        if (p.can_dvr) permList.push('DVR');
        if (p.can_snapshot) permList.push('Foto');
        if (p.can_record) permList.push('Rekam');
        if (p.can_audio) permList.push('Audio');
        if (p.can_gallery) permList.push('Galeri');

        const permsHtml = isAdmin ? 
            `<span class="text-slate-500 text-[10px]">Akses Penuh Semua Fitur</span>` : 
            (permList.length > 0 ? permList.map(item => `<span class="px-1.5 py-0.5 rounded bg-slate-800 text-purple-300 text-[9px] font-mono border border-purple-500/20">${item}</span>`).join(' ') : `<span class="text-slate-500 text-[10px]">Hanya Live Stream</span>`);

        const isMainAdmin = u.id === 'usr_admin';

        return `
            <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-purple-500/30 transition flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                <div class="space-y-1.5 min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-bold text-slate-100 text-sm font-tech">${u.display_name || u.username}</span>
                        <span class="text-slate-400 font-mono text-[11px]">(@${u.username})</span>
                        ${roleBadge}
                    </div>
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="text-slate-400 text-[11px]">Kamera Diizinkan:</span>
                        ${camBadges}
                    </div>
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="text-slate-400 text-[11px]">Izin Fitur:</span>
                        ${permsHtml}
                    </div>
                </div>

                <!-- Action Buttons -->
                <div class="flex items-center gap-1.5 shrink-0 flex-wrap">
                    <!-- Copy Magic Share Link -->
                    <button onclick="copyUserMagicLink('${u.token}', '${u.display_name || u.username}')" 
                            class="px-2.5 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-semibold flex items-center gap-1.5 transition" title="Salin Magic Link untuk dikirim via WA">
                        <i data-lucide="link" class="w-3.5 h-3.5 text-cyan-400"></i>
                        <span>Salin Link</span>
                    </button>

                    <!-- Edit User -->
                    <button onclick="showEditUserForm('${u.id}')" 
                            class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition" title="Ubah Pengaturan Pengguna">
                        <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                    </button>

                    <!-- Reset Token -->
                    <button onclick="regenerateUserToken('${u.id}', '${u.username}')" 
                            class="p-1.5 rounded-lg bg-slate-800 hover:bg-amber-500/20 text-slate-300 hover:text-amber-400 border border-slate-700 transition" title="Reset Magic Link (Batalkan Link Lama)">
                        <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
                    </button>

                    <!-- Delete User (Forbidden for Main Admin) -->
                    ${!isMainAdmin ? `
                    <button onclick="deleteUserAction('${u.id}', '${u.username}')" 
                            class="p-1.5 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 border border-slate-700 transition" title="Hapus Pengguna">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

function showCreateUserForm() {
    const formContainer = document.getElementById('user-form-container');
    if (!formContainer) return;
    document.getElementById('user-form-title').innerHTML = `<i data-lucide="user-plus" class="w-4 h-4"></i> Form Pengguna Baru`;
    document.getElementById('usr-form-id').value = '';
    document.getElementById('usr-form-username').value = '';
    document.getElementById('usr-form-username').disabled = false;
    document.getElementById('usr-form-display').value = '';
    document.getElementById('usr-form-password').value = '';
    document.getElementById('usr-form-pwd-hint').classList.add('hidden');
    document.getElementById('usr-form-role').value = 'user';

    // Populate camera checkboxes
    populateCameraCheckboxes(['cam-1']);

    // Permissions defaults for user
    document.getElementById('perm-ptz').checked = false;
    document.getElementById('perm-dvr').checked = false;
    document.getElementById('perm-snapshot').checked = false;
    document.getElementById('perm-record').checked = false;
    document.getElementById('perm-audio').checked = true;
    document.getElementById('perm-gallery').checked = false;

    formContainer.classList.remove('hidden');
    handleRoleChange('user');
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

function showEditUserForm(userId) {
    const user = state.allUsers.find(u => u.id === userId);
    if (!user) return;

    const formContainer = document.getElementById('user-form-container');
    if (!formContainer) return;

    document.getElementById('user-form-title').innerHTML = `<i data-lucide="edit-3" class="w-4 h-4"></i> Edit Pengguna: ${user.display_name || user.username}`;
    document.getElementById('usr-form-id').value = user.id;
    document.getElementById('usr-form-username').value = user.username;
    document.getElementById('usr-form-username').disabled = true; // Username locked
    document.getElementById('usr-form-display').value = user.display_name || '';
    document.getElementById('usr-form-password').value = '';
    document.getElementById('usr-form-pwd-hint').classList.remove('hidden');
    document.getElementById('usr-form-role').value = user.role;

    // Populate camera checkboxes
    populateCameraCheckboxes(user.allowed_cameras || []);

    // Permissions
    const p = user.permissions || {};
    document.getElementById('perm-ptz').checked = !!p.can_ptz;
    document.getElementById('perm-dvr').checked = !!p.can_dvr;
    document.getElementById('perm-snapshot').checked = !!p.can_snapshot;
    document.getElementById('perm-record').checked = !!p.can_record;
    document.getElementById('perm-audio').checked = p.can_audio !== false;
    document.getElementById('perm-gallery').checked = !!p.can_gallery;

    formContainer.classList.remove('hidden');
    handleRoleChange(user.role);
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

function hideUserForm() {
    const formContainer = document.getElementById('user-form-container');
    if (formContainer) formContainer.classList.add('hidden');
}

function handleRoleChange(role) {
    const camSection = document.getElementById('usr-cameras-section');
    const permSection = document.getElementById('usr-perms-section');
    if (role === 'admin') {
        if (camSection) camSection.classList.add('opacity-50', 'pointer-events-none');
        if (permSection) permSection.classList.add('opacity-50', 'pointer-events-none');
    } else {
        if (camSection) camSection.classList.remove('opacity-50', 'pointer-events-none');
        if (permSection) permSection.classList.remove('opacity-50', 'pointer-events-none');
    }
}

function populateCameraCheckboxes(selectedIds = []) {
    const container = document.getElementById('usr-camera-checkboxes');
    if (!container) return;

    const availableCams = [
        { id: 'cam-1', name: 'CAM 01 - Main Entrance' },
        { id: 'cam-2', name: 'CAM 02 - Corridor & Hallway' },
        { id: 'cam-3', name: 'CAM 03 - Backyard & Perimeter' },
        { id: 'cam-4', name: 'CAM 04 - Ruang Tamu' }
    ];

    container.innerHTML = availableCams.map(c => {
        const isChecked = selectedIds.includes('*') || selectedIds.includes(c.id);
        return `
            <label class="flex items-center gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer hover:border-slate-700">
                <input type="checkbox" value="${c.id}" class="usr-cam-chk rounded bg-slate-800 border-slate-700 text-cyan-400 focus:ring-0" ${isChecked ? 'checked' : ''}>
                <span class="truncate">${c.name}</span>
            </label>
        `;
    }).join('');
}

async function saveUserSubmit() {
    const userId = document.getElementById('usr-form-id').value;
    const username = document.getElementById('usr-form-username').value.trim();
    const displayName = document.getElementById('usr-form-display').value.trim();
    const password = document.getElementById('usr-form-password').value;
    const role = document.getElementById('usr-form-role').value;

    if (!username) {
        showToast('Username wajib diisi!', 'error');
        return;
    }

    if (!userId && (!password || password.length < 4)) {
        showToast('Password minimal 4 karakter!', 'error');
        return;
    }

    // Checked cameras
    const checkedCams = [];
    document.querySelectorAll('.usr-cam-chk:checked').forEach(cb => {
        checkedCams.push(cb.value);
    });

    if (role !== 'admin' && checkedCams.length === 0) {
        showToast('Pilih minimal 1 kamera untuk pengguna ini!', 'error');
        return;
    }

    // Permissions
    const permissions = {
        can_ptz: document.getElementById('perm-ptz').checked,
        can_dvr: document.getElementById('perm-dvr').checked,
        can_snapshot: document.getElementById('perm-snapshot').checked,
        can_record: document.getElementById('perm-record').checked,
        can_audio: document.getElementById('perm-audio').checked,
        can_gallery: document.getElementById('perm-gallery').checked
    };

    const payload = {
        username: username,
        display_name: displayName,
        role: role,
        allowed_cameras: role === 'admin' ? ['*'] : checkedCams,
        permissions: permissions
    };
    if (password) {
        payload.password = password;
    }

    try {
        const url = userId ? `/api/auth/users/${userId}` : '/api/auth/users';
        const method = userId ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast(userId ? 'Pengguna berhasil diperbarui!' : 'Pengguna baru berhasil dibuat!', 'success');
            hideUserForm();
            await loadUsersList();
        } else {
            showToast(data.error || 'Gagal menyimpan pengguna', 'error');
        }
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

async function deleteUserAction(userId, username) {
    const confirmed = await showConfirmDialog({
        title: 'Hapus Akses Pengguna',
        message: `Apakah Anda yakin ingin menghapus akun "${username}"? Hak akses login dan Magic Link mereka akan langsung dicabut seketika.`,
        confirmText: 'Ya, Hapus Pengguna',
        cancelText: 'Batal',
        type: 'danger'
    });
    if (!confirmed) return;

    try {
        const res = await fetch(`/api/auth/users/${userId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast(`Pengguna "${username}" telah berhasil dihapus!`, 'success');
            await loadUsersList();
        } else {
            showToast(data.error || 'Gagal menghapus pengguna', 'error');
        }
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

async function regenerateUserToken(userId, username) {
    const confirmed = await showConfirmDialog({
        title: 'Reset Magic Link',
        message: `Buat token baru untuk "${username}"? Tautan akses lama yang pernah dibagikan tidak akan dapat digunakan lagi.`,
        confirmText: 'Reset Link Baru',
        cancelText: 'Batal',
        type: 'warning'
    });
    if (!confirmed) return;

    try {
        const res = await fetch(`/api/auth/users/${userId}/regenerate-token`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast(`Token baru untuk "${username}" berhasil dibuat!`, 'success');
            await loadUsersList();
        } else {
            showToast(data.error || 'Gagal mereset token', 'error');
        }
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

function copyUserMagicLink(token, displayName) {
    const origin = window.location.origin;
    const magicLink = `${origin}/?token=${encodeURIComponent(token)}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(magicLink).then(() => {
            showToast(`Link akses untuk "${displayName}" telah disalin ke clipboard!`, 'success', 'LINK DISALIN');
        }).catch(() => {
            showToast(`Gagal menyalin otomatis. Link: ${magicLink}`, 'info', 'TAUTAN AKSES');
        });
    } else {
        showToast(`Tautan Akses: ${magicLink}`, 'info', 'TAUTAN AKSES');
    }
}

// ==========================================
// 20. LOGIN & LOGOUT CONTROLLER
// ==========================================

function showLoginModal() {
    const modal = document.getElementById('login-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    const errMsg = document.getElementById('login-error-msg');
    if (errMsg) errMsg.classList.add('hidden');
    const uInput = document.getElementById('login-username');
    if (uInput) uInput.focus();
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

function closeLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

async function handleLoginSubmit(event) {
    event.preventDefault();
    const uInput = document.getElementById('login-username');
    const pInput = document.getElementById('login-password');
    const errMsg = document.getElementById('login-error-msg');
    const btn = document.getElementById('btn-login-submit');

    const username = uInput ? uInput.value.trim() : '';
    const password = pInput ? pInput.value : '';

    if (!username || !password) return;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Memverifikasi...`;
        if (window.lucide && lucide.createIcons) lucide.createIcons();
    }

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.success && data.user) {
            state.currentUser = data.user;
            state.authToken = data.token;
            try {
                localStorage.setItem('cctv_auth_token', data.token);
            } catch (e) {}
            closeLoginModal();
            showToast(`Selamat datang kembali, ${data.user.display_name || data.user.username}!`, 'success', 'AKSES DITERIMA');
            onAuthenticatedSuccess();
        } else {
            if (errMsg) {
                errMsg.textContent = data.error || 'Username atau password salah!';
                errMsg.classList.remove('hidden');
            }
        }
    } catch (e) {
        if (errMsg) {
            errMsg.textContent = `Error koneksi: ${e.message}`;
            errMsg.classList.remove('hidden');
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="log-in" class="w-4 h-4"></i> Masuk ke Sistem`;
            if (window.lucide && lucide.createIcons) lucide.createIcons();
        }
    }
}

async function handleLogout() {
    const confirmed = await showConfirmDialog({
        title: 'Konfirmasi Keluar',
        message: 'Apakah Anda yakin ingin keluar dari sistem CCTV Command Center?',
        confirmText: 'Ya, Keluar',
        cancelText: 'Tetap di Sini',
        type: 'danger'
    });
    if (!confirmed) return;

    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}

    state.currentUser = null;
    state.authToken = '';
    try {
        localStorage.removeItem('cctv_auth_token');
    } catch (e) {}

    // Clean up current streams
    state.cameras = [];
    renderCameraGrid();
    showLoginModal();
    showToast('Anda telah keluar dari sesi sistem pengawasan.', 'info', 'LOGOUT');
}

// ==========================================
// 20. REAL-TIME INTERACTIVE DIGITAL ZOOM & PAN (GPU-ACCELERATED)
// ==========================================
const cameraZoomState = {};
let activePanCamId = null;

function getCamZoomState(camId) {
    if (!cameraZoomState[camId]) {
        cameraZoomState[camId] = {
            scale: 1.0,
            x: 0,
            y: 0,
            isDragging: false,
            startX: 0,
            startY: 0,
            touchDist: 0,
            touchScale: 1.0
        };
    }
    return cameraZoomState[camId];
}

function initCameraZoom(camId) {
    const viewport = document.getElementById(`viewport-${camId}`);
    if (!viewport || viewport.dataset.zoomInitialized === 'true') return;
    viewport.dataset.zoomInitialized = 'true';

    // 1. Mouse Wheel for Realtime Fluid Zoom
    viewport.addEventListener('wheel', (e) => {
        handleCameraWheelZoom(camId, e);
    }, { passive: false });

    // 2. Mouse Down for Pan / Dragging
    viewport.addEventListener('mousedown', (e) => {
        handleCameraPanStart(camId, e);
    });

    // 3. Double-Click to Instant Reset
    viewport.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        resetCameraZoom(camId);
    });

    // 4. Touch Gestures: Pinch-to-Zoom & Drag Pan (Mobile / Tablet)
    viewport.addEventListener('touchstart', (e) => {
        const zState = getCamZoomState(camId);
        if (e.touches.length === 2) {
            e.preventDefault();
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            zState.touchDist = dist;
            zState.touchScale = zState.scale;
        } else if (e.touches.length === 1 && zState.scale > 1.0) {
            zState.isDragging = true;
            zState.startX = e.touches[0].clientX - zState.x;
            zState.startY = e.touches[0].clientY - zState.y;
            activePanCamId = camId;
        }
    }, { passive: false });

    viewport.addEventListener('touchmove', (e) => {
        const zState = getCamZoomState(camId);
        const container = document.getElementById(`zoom-container-${camId}`);
        const badge = document.getElementById(`zoom-badge-${camId}`);
        const valSpan = document.getElementById(`zoom-val-${camId}`);
        if (!container) return;

        if (e.touches.length === 2 && zState.touchDist > 0) {
            e.preventDefault();
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const ratio = dist / zState.touchDist;
            let newScale = Math.max(1.0, Math.min(8.0, zState.touchScale * ratio));
            if (newScale < 1.06) newScale = 1.0;

            zState.scale = newScale;
            if (newScale === 1.0) {
                zState.x = 0;
                zState.y = 0;
                container.style.transform = '';
                if (badge) { badge.classList.add('hidden'); badge.classList.remove('flex'); }
            } else {
                container.style.transform = `translate3d(${zState.x.toFixed(2)}px, ${zState.y.toFixed(2)}px, 0px) scale(${newScale.toFixed(3)})`;
                if (badge && valSpan) {
                    valSpan.textContent = newScale.toFixed(1) + 'x';
                    badge.classList.remove('hidden');
                    badge.classList.add('flex');
                }
            }
        } else if (e.touches.length === 1 && zState.isDragging) {
            e.preventDefault();
            const rect = viewport.getBoundingClientRect();
            const maxTranslateX = (rect.width * (zState.scale - 1)) / 2;
            const maxTranslateY = (rect.height * (zState.scale - 1)) / 2;

            let curX = e.touches[0].clientX - zState.startX;
            let curY = e.touches[0].clientY - zState.startY;

            zState.x = Math.max(-maxTranslateX, Math.min(maxTranslateX, curX));
            zState.y = Math.max(-maxTranslateY, Math.min(maxTranslateY, curY));

            container.style.transform = `translate3d(${zState.x.toFixed(2)}px, ${zState.y.toFixed(2)}px, 0px) scale(${zState.scale.toFixed(3)})`;
        }
    }, { passive: false });

    viewport.addEventListener('touchend', (e) => {
        const zState = getCamZoomState(camId);
        if (e.touches.length < 2) zState.touchDist = 0;
        if (e.touches.length === 0) {
            zState.isDragging = false;
            activePanCamId = null;
        }
    });
}

function handleCameraWheelZoom(camId, e) {
    const viewport = document.getElementById(`viewport-${camId}`);
    const container = document.getElementById(`zoom-container-${camId}`);
    const badge = document.getElementById(`zoom-badge-${camId}`);
    const valSpan = document.getElementById(`zoom-val-${camId}`);
    if (!viewport || !container) return;

    // Prevent whole window/page from scrolling while zooming
    e.preventDefault();
    e.stopPropagation();

    const zState = getCamZoomState(camId);
    const rect = viewport.getBoundingClientRect();

    // Mouse focal point relative to viewport center
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const offsetX = e.clientX - centerX;
    const offsetY = e.clientY - centerY;

    const oldScale = zState.scale;
    // Step: 1.25x on scroll up (zoom in), 0.8x on scroll down (zoom out)
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    let newScale = oldScale * factor;

    // Min and Max zoom thresholds
    if (newScale < 1.08) {
        newScale = 1.0;
    } else if (newScale > 8.0) {
        newScale = 8.0;
    }

    if (newScale === 1.0) {
        zState.scale = 1.0;
        zState.x = 0;
        zState.y = 0;
        zState.isDragging = false;
        container.style.transition = 'transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1)';
        container.style.transform = '';
        viewport.style.cursor = 'default';
        if (badge) {
            badge.classList.add('hidden');
            badge.classList.remove('flex');
        }
        setTimeout(() => {
            if (container) container.style.transition = '';
        }, 150);
        return;
    }

    // Focal Point Mathematics: Keep point under mouse fixed while scaling
    let newX = offsetX - (offsetX - zState.x) * (newScale / oldScale);
    let newY = offsetY - (offsetY - zState.y) * (newScale / oldScale);

    // Boundary constraints to keep video within viewport
    const maxTranslateX = (rect.width * (newScale - 1)) / 2;
    const maxTranslateY = (rect.height * (newScale - 1)) / 2;
    newX = Math.max(-maxTranslateX, Math.min(maxTranslateX, newX));
    newY = Math.max(-maxTranslateY, Math.min(maxTranslateY, newY));

    zState.scale = newScale;
    zState.x = newX;
    zState.y = newY;

    container.style.transition = 'transform 0.06s ease-out';
    container.style.transform = `translate3d(${newX.toFixed(2)}px, ${newY.toFixed(2)}px, 0px) scale(${newScale.toFixed(3)})`;
    viewport.style.cursor = 'grab';

    if (badge && valSpan) {
        valSpan.textContent = newScale.toFixed(1) + 'x';
        badge.classList.remove('hidden');
        badge.classList.add('flex');
    }

    setTimeout(() => {
        if (container) container.style.transition = '';
    }, 60);
}

function handleCameraPanStart(camId, e) {
    // Only primary left click
    if (e.button !== 0) return;
    // Don't drag if clicking buttons, badges or DVR controls
    if (e.target.closest('button') || e.target.closest('#zoom-badge-' + camId) || e.target.closest('.cam-card-hover-toolbar') || e.target.closest('.cam-card-dvr-panel')) return;

    const zState = getCamZoomState(camId);
    if (zState.scale <= 1.0) return;

    e.preventDefault();
    zState.isDragging = true;
    zState.startX = e.clientX - zState.x;
    zState.startY = e.clientY - zState.y;
    activePanCamId = camId;

    const viewport = document.getElementById(`viewport-${camId}`);
    if (viewport) viewport.style.cursor = 'grabbing';
}

function resetCameraZoom(camId) {
    const zState = getCamZoomState(camId);
    zState.scale = 1.0;
    zState.x = 0;
    zState.y = 0;
    zState.isDragging = false;
    activePanCamId = null;

    const viewport = document.getElementById(`viewport-${camId}`);
    const container = document.getElementById(`zoom-container-${camId}`);
    const badge = document.getElementById(`zoom-badge-${camId}`);

    if (container) {
        container.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
        container.style.transform = '';
        setTimeout(() => {
            if (container) container.style.transition = '';
        }, 200);
    }
    if (viewport) {
        viewport.style.cursor = 'default';
    }
    if (badge) {
        badge.classList.add('hidden');
        badge.classList.remove('flex');
    }
}

function handleQuickZoomBtn(camId) {
    const zState = getCamZoomState(camId);
    let targetScale = 1.0;
    if (zState.scale < 1.8) {
        targetScale = 2.0;
    } else if (zState.scale < 3.2) {
        targetScale = 3.5;
    } else {
        targetScale = 1.0;
    }

    if (targetScale === 1.0) {
        resetCameraZoom(camId);
    } else {
        const viewport = document.getElementById(`viewport-${camId}`);
        const container = document.getElementById(`zoom-container-${camId}`);
        const badge = document.getElementById(`zoom-badge-${camId}`);
        const valSpan = document.getElementById(`zoom-val-${camId}`);
        if (!viewport || !container) return;

        zState.scale = targetScale;
        zState.x = 0;
        zState.y = 0;
        container.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
        container.style.transform = `translate3d(0px, 0px, 0px) scale(${targetScale.toFixed(2)})`;
        viewport.style.cursor = 'grab';
        if (badge && valSpan) {
            valSpan.textContent = targetScale.toFixed(1) + 'x';
            badge.classList.remove('hidden');
            badge.classList.add('flex');
        }
        setTimeout(() => {
            if (container) container.style.transition = '';
        }, 200);
    }
}

// Window mouse listeners for smooth pan dragging across the entire viewport
window.addEventListener('mousemove', (e) => {
    if (!activePanCamId) return;
    const zState = cameraZoomState[activePanCamId];
    if (!zState || !zState.isDragging) return;

    const viewport = document.getElementById(`viewport-${activePanCamId}`);
    const container = document.getElementById(`zoom-container-${activePanCamId}`);
    if (!viewport || !container) return;

    const rect = viewport.getBoundingClientRect();
    const maxTranslateX = (rect.width * (zState.scale - 1)) / 2;
    const maxTranslateY = (rect.height * (zState.scale - 1)) / 2;

    let curX = e.clientX - zState.startX;
    let curY = e.clientY - zState.startY;

    zState.x = Math.max(-maxTranslateX, Math.min(maxTranslateX, curX));
    zState.y = Math.max(-maxTranslateY, Math.min(maxTranslateY, curY));

    container.style.transform = `translate3d(${zState.x.toFixed(2)}px, ${zState.y.toFixed(2)}px, 0px) scale(${zState.scale.toFixed(3)})`;
});

window.addEventListener('mouseup', () => {
    if (!activePanCamId) return;
    const zState = cameraZoomState[activePanCamId];
    if (zState) {
        zState.isDragging = false;
        const viewport = document.getElementById(`viewport-${activePanCamId}`);
        if (viewport) {
            viewport.style.cursor = zState.scale > 1.0 ? 'grab' : 'default';
        }
    }
    activePanCamId = null;
});

// ==========================================
// 21. INITIALIZE ON DOM READY
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Restore layout and setup wakelock & clock
    setLayout(state.currentLayout);
    requestWakeLock();
    updateClock();
    state.clockInterval = setInterval(updateClock, 1000);

    // 2. Check for token in URL query parameter (?token=xyz)
    const urlParams = new URLSearchParams(window.location.search);
    const tokenInUrl = urlParams.get('token');
    if (tokenInUrl) {
        state.authToken = tokenInUrl;
        try {
            localStorage.setItem('cctv_auth_token', tokenInUrl);
        } catch (e) {}
    }

    // 3. Verify authentication status
    const isAuth = await checkAuthStatus();
    if (!isAuth) {
        showLoginModal();
    } else {
        onAuthenticatedSuccess();
    }
});
