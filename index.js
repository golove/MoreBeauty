const GAP = 8;
const MAX_CARD_WIDTH = 200;
const MIN_CARD_WIDTH = 140;
const MODAL_TOP_OFFSET = 72;
const SURFACE_PADDING = 80;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3;
const ZOOM_STEP = 1.3;
const WHEEL_ZOOM_SENSITIVITY = 0.0026;
const VIEW_ANIMATION_DURATION = 160;
const SLIDESHOW_SETTLE_DURATION = 220;
const DRAG_THRESHOLD = 6;
const PINCH_ZOOM_EXPONENT = 1.75;
const SLIDESHOW_TRIGGER_SCALE = MAX_SCALE * 0.985;
const SLIDESHOW_EXIT_SCALE = 2.2;
const APP_TIP_STORAGE_KEY = 'morebeauty.appTipHidden';

const state = {
    albums: [],
    albumCards: [],
    modalCards: [],
    activeAlbum: null,
    surfaces: {
        app: null,
        modal: null
    }
};

async function init() {
    const modal = document.getElementById('modal');
    const modalClose = document.getElementById('modal-close');
    const appViewport = document.getElementById('app-viewport');
    const appCanvas = document.getElementById('app-canvas');
    const modalViewport = document.getElementById('modal-viewport');
    const modalCanvas = document.getElementById('modal-canvas');
    const appTip = document.getElementById('app-tip');
    const appTipClose = document.getElementById('app-tip-close');

    if (!modal || !modalClose || !appViewport || !appCanvas || !modalViewport || !modalCanvas) {
        return;
    }

    state.surfaces.app = createSurface('app', appViewport, appCanvas);
    state.surfaces.modal = createSurface('modal', modalViewport, modalCanvas);

    bindGlobalEvents(modal, modalClose, appTip, appTipClose);

    try {
        state.albums = await loadData();
        renderAlbumGrid();
    } catch (error) {
        renderAppMessage(
            state.surfaces.app.canvas,
            '图片数据加载失败',
            window.location.protocol === 'file:'
                ? '请使用本地 HTTP 服务启动当前目录，例如运行 python3 -m http.server 8000。'
                : '请稍后重试，或检查 vipPicture.json 是否可访问。'
        );
        setEmptySurface(state.surfaces.app);
        console.error(error);
    }
}

function createSurface(name, viewport, canvas) {
    const zoomLabel = document.querySelector(`[data-zoom-label="${name}"]`);
    const slideCounter = name === 'modal' ? document.getElementById('modal-slide-counter') : null;
    const surface = {
        name,
        viewport,
        canvas,
        zoomLabel,
        slideCounter,
        scale: 1,
        x: 0,
        y: 0,
        contentWidth: 0,
        contentHeight: 0,
        pointerId: null,
        startPointerX: 0,
        startPointerY: 0,
        startX: 0,
        startY: 0,
        activePointers: new Map(),
        isPinching: false,
        pinchStartDistance: 0,
        pinchStartScale: 1,
        pinchAnchorX: 0,
        pinchAnchorY: 0,
        isDragging: false,
        clickSuppressed: false,
        renderFrame: 0,
        viewAnimationFrame: 0,
        isSlideshow: false,
        isSlideshowSettled: false,
        slideshowIndex: 0,
        slideshowSettleTimer: 0
    };

    bindSurfaceEvents(surface);
    updateSurfaceTransform(surface);

    return surface;
}

function bindGlobalEvents(modal, modalClose, appTip, appTipClose) {
    const debouncedResize = debounce(() => {
        relayoutSurface(state.surfaces.app, state.albumCards, getAlbumHeight);

        if (state.activeAlbum) {
            relayoutSurface(state.surfaces.modal, state.modalCards, getImageHeight, MODAL_TOP_OFFSET);
        }
    }, 160);

    window.addEventListener('resize', debouncedResize);
    window.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            closeModal(modal);
            return;
        }

        if (!state.surfaces.modal.isSlideshow) {
            return;
        }

        if (event.key === 'ArrowRight') {
            navigateSlideshow(state.surfaces.modal, 1, true);
        } else if (event.key === 'ArrowLeft') {
            navigateSlideshow(state.surfaces.modal, -1, true);
        }
    });

    modalClose.addEventListener('click', () => closeModal(modal));
    modal.addEventListener('click', event => {
        if (event.target === modal) {
            closeModal(modal);
        }
    });

    if (appTip && getStoredBoolean(APP_TIP_STORAGE_KEY)) {
        appTip.classList.add('is-hidden');
    }

    if (appTip && appTipClose) {
        appTipClose.addEventListener('click', () => {
            appTip.classList.add('is-hidden');
            setStoredBoolean(APP_TIP_STORAGE_KEY, true);
        });
    }

    document.querySelectorAll('[data-action][data-target]').forEach(button => {
        button.addEventListener('click', () => {
            const surface = state.surfaces[button.dataset.target];

            if (!surface) {
                return;
            }

            if (button.dataset.action === 'zoom-in') {
                if (surface.isSlideshow) {
                    return;
                }
                zoomSurfaceByStep(surface, ZOOM_STEP, true);
            } else if (button.dataset.action === 'zoom-out') {
                if (surface.isSlideshow) {
                    exitSlideshowMode(surface, true);
                    return;
                }
                zoomSurfaceByStep(surface, 1 / ZOOM_STEP, true);
            } else if (button.dataset.action === 'fit') {
                if (surface.isSlideshow) {
                    exitSlideshowMode(surface, true);
                    return;
                }
                fitSurface(surface, true);
            } else if (button.dataset.action === 'reset') {
                if (surface.isSlideshow) {
                    exitSlideshowMode(surface, true);
                    return;
                }
                resetSurface(surface, true);
            } else if (button.dataset.action === 'prev-slide') {
                navigateSlideshow(surface, -1, true);
            } else if (button.dataset.action === 'next-slide') {
                navigateSlideshow(surface, 1, true);
            }
        });
    });
}

function relayoutSurface(surface, cards, heightGetter, topOffset = GAP) {
    if (!surface || !cards.length) {
        return;
    }

    if (surface.isSlideshow && surface.name === 'modal') {
        layoutSlideshow(surface, cards, surface.slideshowIndex);
        return;
    }

    layoutCards(surface, cards, heightGetter, topOffset);
    clampSurfacePosition(surface);
    updateSurfaceTransform(surface);
}

function bindSurfaceEvents(surface) {
    surface.viewport.addEventListener(
        'click',
        event => {
            if (surface.clickSuppressed) {
                event.preventDefault();
                event.stopPropagation();
                surface.clickSuppressed = false;
            }
        },
        true
    );

    surface.viewport.addEventListener('pointerdown', event => {
        if (!isPrimaryPointer(event)) {
            return;
        }

        surface.activePointers.set(event.pointerId, {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY
        });

        if (surface.activePointers.size >= 2) {
            beginSurfacePinch(surface);
            return;
        }

        beginSurfaceDrag(surface, event.pointerId, event.clientX, event.clientY);
    });

    surface.viewport.addEventListener('pointermove', event => {
        if (!surface.activePointers.has(event.pointerId)) {
            return;
        }

        surface.activePointers.set(event.pointerId, {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY
        });

        if (surface.isSlideshow) {
            if (surface.activePointers.size >= 2) {
                const pointers = getTrackedPointers(surface);

                if (!surface.isPinching) {
                    beginSurfacePinch(surface);
                }

                const distance = Math.max(getPointerDistance(pointers[0], pointers[1]), 1);

                if (distance / surface.pinchStartDistance < 0.88) {
                    exitSlideshowMode(surface, true);
                }

                return;
            }

            if (surface.pointerId !== event.pointerId) {
                return;
            }

            const deltaX = event.clientX - surface.startPointerX;
            const deltaY = event.clientY - surface.startPointerY;

            if (Math.abs(deltaX) > 56 && Math.abs(deltaX) > Math.abs(deltaY)) {
                navigateSlideshow(surface, deltaX < 0 ? 1 : -1, true);
                surface.startPointerX = event.clientX;
                surface.startPointerY = event.clientY;
                surface.clickSuppressed = true;
            }

            return;
        }

        if (surface.activePointers.size >= 2) {
            if (!surface.isPinching) {
                beginSurfacePinch(surface);
            }

            updateSurfacePinch(surface);
            return;
        }

        if (surface.pointerId !== event.pointerId) {
            return;
        }

        const deltaX = event.clientX - surface.startPointerX;
        const deltaY = event.clientY - surface.startPointerY;

        if (!surface.isDragging && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
            surface.isDragging = true;
            surface.clickSuppressed = true;
            ensurePointerCapture(surface, event.pointerId);
            surface.viewport.classList.add('is-dragging');
        }

        if (!surface.isDragging) {
            return;
        }

        surface.x = surface.startX + deltaX;
        surface.y = surface.startY + deltaY;
        clampSurfacePosition(surface);
        updateSurfaceTransform(surface);
    });

    surface.viewport.addEventListener('pointerup', event => {
        releaseSurfacePointer(surface, event.pointerId);
    });

    surface.viewport.addEventListener('pointercancel', event => {
        releaseSurfacePointer(surface, event.pointerId);
    });

    surface.viewport.addEventListener('wheel', event => {
        event.preventDefault();
        stopSurfaceAnimation(surface);

        if (surface.isSlideshow) {
            if (event.ctrlKey || event.metaKey) {
                if (getNormalizedWheelDelta(event) > 0) {
                    exitSlideshowMode(surface, true);
                }
                return;
            }

            const horizontalDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

            if (Math.abs(horizontalDelta) > 8) {
                navigateSlideshow(surface, horizontalDelta > 0 ? 1 : -1, true);
            }

            return;
        }

        if (event.ctrlKey || event.metaKey) {
            const factor = Math.exp(-getNormalizedWheelDelta(event) * WHEEL_ZOOM_SENSITIVITY);
            zoomSurface(surface, surface.scale * factor, event.clientX, event.clientY);
            return;
        }

        surface.x -= event.deltaX;
        surface.y -= event.deltaY;
        clampSurfacePosition(surface);
        updateSurfaceTransform(surface);
    }, { passive: false });

    surface.viewport.addEventListener('dblclick', event => {
        const nextScale = surface.scale < 1.4 ? 1.8 : 1;
        zoomSurface(surface, nextScale, event.clientX, event.clientY, true);
    });
}

function renderAlbumGrid(shouldReset = true) {
    const surface = state.surfaces.app;

    clearCanvas(surface.canvas);

    if (!state.albums.length) {
        renderAppMessage(surface.canvas, '暂无图片数据', '可以检查 vipPicture.json 是否为空。');
        setEmptySurface(surface);
        return;
    }

    state.albumCards = state.albums.map(album => createAlbumCard(album));
    surface.canvas.append(...state.albumCards);
    layoutCards(surface, state.albumCards, getAlbumHeight);

    if (shouldReset) {
        resetSurface(surface);
    } else {
        clampSurfacePosition(surface);
        updateSurfaceTransform(surface);
    }
}

function renderModalGrid(album, shouldReset = true) {
    const surface = state.surfaces.modal;
    const modal = document.getElementById('modal');

    clearCanvas(surface.canvas);
    surface.isSlideshow = false;
    surface.isSlideshowSettled = false;
    surface.slideshowIndex = 0;
    syncSlideshowState(surface, modal);

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = album.title || 'Untitled Album';
    surface.canvas.appendChild(title);

    state.modalCards = (album.srcs || []).map(image => createImageCard(image));
    surface.canvas.append(...state.modalCards);
    layoutCards(surface, state.modalCards, getImageHeight, MODAL_TOP_OFFSET);

    if (shouldReset) {
        resetSurface(surface);
    } else {
        clampSurfacePosition(surface);
        updateSurfaceTransform(surface);
    }
}

function openAlbum(album) {
    const modal = document.getElementById('modal');

    if (!modal) {
        return;
    }

    state.activeAlbum = album;
    renderModalGrid(album);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
}

function closeModal(modal) {
    if (!state.activeAlbum) {
        return;
    }

    state.activeAlbum = null;
    state.modalCards = [];
    modal.classList.remove('is-open');
    modal.classList.remove('is-slideshow');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    clearCanvas(state.surfaces.modal.canvas);
    state.surfaces.modal.isSlideshow = false;
    state.surfaces.modal.isSlideshowSettled = false;
    state.surfaces.modal.slideshowIndex = 0;
    syncSlideshowState(state.surfaces.modal, modal);
    setEmptySurface(state.surfaces.modal);
}

function createAlbumCard(album) {
    const card = buildCardShell();
    card.classList.add('album-card');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', album.title || 'Open album');
    card.dataset.aspectRatio = String(getAspectRatio(getAlbumAspectRatio(album)));
    card.style.setProperty('--card-accent', getAccentColor(album.title || String(album.id || 'album')));

    const img = buildImageNode(getCoverSrc(album), album.title || 'Album cover');
    const overlay = document.createElement('div');
    overlay.className = 'card-overlay';

    const title = document.createElement('h3');
    title.className = 'card-title';
    title.textContent = album.title || 'Untitled Album';

    overlay.appendChild(title);
    card.appendChild(img);
    card.appendChild(overlay);

    const handleOpen = () => openAlbum(album);
    card.addEventListener('click', handleOpen);
    card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleOpen();
        }
    });

    return card;
}

function createImageCard(image) {
    const card = buildCardShell();
    card.dataset.aspectRatio = String(getAspectRatio(image.aspect_ratio));
    card.style.setProperty('--card-accent', getAccentColor(image.src || 'image'));
    card.appendChild(buildImageNode(image.src, 'Album image'));
    return card;
}

function buildCardShell() {
    const card = document.createElement('article');
    card.className = 'card';
    return card;
}

function buildImageNode(src, alt) {
    const img = document.createElement('img');
    img.src = src || '';
    img.alt = alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    return img;
}

function layoutCards(surface, cards, heightGetter, topOffset = GAP) {
    if (!cards.length) {
        surface.contentWidth = surface.viewport.clientWidth;
        surface.contentHeight = Math.max(topOffset, surface.viewport.clientHeight);
        surface.canvas.style.width = `${surface.contentWidth}px`;
        surface.canvas.style.height = `${surface.contentHeight}px`;
        return;
    }

    const { cols, cardWidth, startX, contentWidth } = getLayoutMetrics(surface.viewport.clientWidth);
    const columnHeights = new Array(cols).fill(topOffset);

    cards.forEach(card => {
        const height = heightGetter(cardWidth, card);
        const columnIndex = getShortestColumnIndex(columnHeights);

        card.style.width = `${cardWidth}px`;
        card.style.height = `${height}px`;
        card.style.left = `${startX + columnIndex * (cardWidth + GAP)}px`;
        card.style.top = `${columnHeights[columnIndex]}px`;

        columnHeights[columnIndex] += height + GAP;
    });

    surface.contentWidth = Math.max(contentWidth, surface.viewport.clientWidth);
    surface.contentHeight = Math.max(Math.max(...columnHeights), surface.viewport.clientHeight);
    surface.canvas.style.width = `${surface.contentWidth}px`;
    surface.canvas.style.height = `${surface.contentHeight}px`;
}

function layoutSlideshow(surface, cards, activeIndex = 0) {
    const viewportWidth = surface.viewport.clientWidth;
    const viewportHeight = surface.viewport.clientHeight;
    const safeTop = MODAL_TOP_OFFSET + 28;
    const slideWidth = viewportWidth;
    const slideHeight = viewportHeight;
    const frameWidth = Math.max(240, viewportWidth - SURFACE_PADDING * 2);
    const frameHeight = Math.max(180, viewportHeight - safeTop - SURFACE_PADDING);

    cards.forEach((card, index) => {
        const aspectRatio = getAspectRatio(card.dataset.aspectRatio);
        const widthByHeight = frameHeight * aspectRatio;
        const heightByWidth = frameWidth / aspectRatio;
        const width = Math.min(frameWidth, widthByHeight);
        const height = Math.min(frameHeight, heightByWidth);
        const slideX = index * slideWidth;
        const left = slideX + Math.round((slideWidth - width) / 2);
        const top = safeTop + Math.max(0, Math.round((frameHeight - height) / 2));

        card.style.width = `${width}px`;
        card.style.height = `${height}px`;
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
    });

    surface.contentWidth = cards.length * slideWidth;
    surface.contentHeight = slideHeight;
    surface.canvas.style.width = `${surface.contentWidth}px`;
    surface.canvas.style.height = `${surface.contentHeight}px`;
    surface.scale = 1;
    surface.y = 0;
    surface.slideshowIndex = clamp(activeIndex, 0, Math.max(cards.length - 1, 0));
    syncSlideshowState(surface, document.getElementById('modal'));
    setSurfaceView(surface, 1, -surface.slideshowIndex * slideWidth, 0, true);
}

function getLayoutMetrics(containerWidth) {
    const availableWidth = Math.max(containerWidth - SURFACE_PADDING * 2, MIN_CARD_WIDTH + GAP * 2);
    const cols = Math.max(1, Math.floor((availableWidth + GAP) / (MAX_CARD_WIDTH + GAP)));
    const rawWidth = Math.floor((availableWidth - GAP * (cols - 1)) / cols);
    const cardWidth = Math.max(Math.min(rawWidth, MAX_CARD_WIDTH), Math.min(MIN_CARD_WIDTH, availableWidth));
    const contentWidth = cols * cardWidth + GAP * (cols - 1);
    const startX = Math.max(SURFACE_PADDING, Math.floor((containerWidth - contentWidth) / 2));

    return { cols, cardWidth, startX, contentWidth: startX * 2 + contentWidth };
}

function getShortestColumnIndex(columnHeights) {
    let targetIndex = 0;

    for (let index = 1; index < columnHeights.length; index += 1) {
        if (columnHeights[index] < columnHeights[targetIndex]) {
            targetIndex = index;
        }
    }

    return targetIndex;
}

function getAlbumHeight(cardWidth, card) {
    return getCardHeight(cardWidth, card.dataset.aspectRatio);
}

function getImageHeight(cardWidth, card) {
    return getCardHeight(cardWidth, card.dataset.aspectRatio);
}

function getCardHeight(cardWidth, rawAspectRatio) {
    return Math.max(120, Math.round(cardWidth / getAspectRatio(rawAspectRatio)));
}

function getAspectRatio(value) {
    const aspectRatio = Number(value);
    return aspectRatio > 0 ? aspectRatio : 1;
}

function getCoverSrc(album) {
    return album.srcs && album.srcs[0] ? album.srcs[0].src : '';
}

function getAlbumAspectRatio(album) {
    return album.srcs && album.srcs[0] ? album.srcs[0].aspect_ratio : 1;
}

function clearCanvas(canvas) {
    canvas.innerHTML = '';
    canvas.classList.remove('is-empty');
    canvas.style.width = '';
    canvas.style.height = '';
}

function setEmptySurface(surface) {
    surface.contentWidth = surface.viewport.clientWidth;
    surface.contentHeight = surface.viewport.clientHeight;
    surface.canvas.style.width = `${surface.contentWidth}px`;
    surface.canvas.style.height = `${surface.contentHeight}px`;
    surface.canvas.classList.add('is-empty');
    resetSurface(surface);
}

function renderAppMessage(canvas, title, description) {
    const box = document.createElement('section');
    box.className = 'app-message';

    const heading = document.createElement('h2');
    heading.textContent = title;

    const text = document.createElement('p');
    text.textContent = description;

    box.appendChild(heading);
    box.appendChild(text);
    canvas.appendChild(box);
}

async function loadData() {
    const response = await fetch('vipPicture.json');

    if (!response.ok) {
        throw new Error(`Failed to load vipPicture.json: ${response.status}`);
    }

    const data = await response.json();

    return data.map(album => ({
        ...album,
        srcs: Array.isArray(album.srcs) ? album.srcs : []
    }));
}

function resetSurface(surface, animate = false) {
    const viewportWidth = surface.viewport.clientWidth;
    const viewportHeight = surface.viewport.clientHeight;
    const scale = 1;
    const scaledWidth = surface.contentWidth * scale;
    const scaledHeight = surface.contentHeight * scale;
    const x = scaledWidth < viewportWidth
        ? Math.round((viewportWidth - scaledWidth) / 2)
        : SURFACE_PADDING * 0.5;
    const y = scaledHeight < viewportHeight
        ? Math.round((viewportHeight - scaledHeight) / 2)
        : SURFACE_PADDING * 0.5;

    setSurfaceView(surface, scale, x, y, animate);
}

function fitSurface(surface, animate = false) {
    const viewportWidth = surface.viewport.clientWidth;
    const viewportHeight = surface.viewport.clientHeight;
    const availableWidth = Math.max(1, viewportWidth - SURFACE_PADDING * 2);
    const availableHeight = Math.max(1, viewportHeight - SURFACE_PADDING * 2);
    const scaleByWidth = availableWidth / Math.max(surface.contentWidth, 1);
    const scaleByHeight = availableHeight / Math.max(surface.contentHeight, 1);

    const scale = clamp(Math.min(scaleByWidth, scaleByHeight, 1), MIN_SCALE, MAX_SCALE);
    const x = Math.round((viewportWidth - surface.contentWidth * scale) / 2);
    const y = Math.round((viewportHeight - surface.contentHeight * scale) / 2);

    setSurfaceView(surface, scale, x, y, animate);
}

function zoomSurfaceByStep(surface, factor, animate = false) {
    const rect = surface.viewport.getBoundingClientRect();
    zoomSurface(
        surface,
        surface.scale * factor,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        animate
    );
}

function zoomSurface(surface, nextScale, clientX, clientY, animate = false) {
    const boundedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    const rect = surface.viewport.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const contentX = (localX - surface.x) / surface.scale;
    const contentY = (localY - surface.y) / surface.scale;

    if (shouldEnterSlideshow(surface, boundedScale)) {
        enterSlideshowMode(surface, contentX, contentY);
        return;
    }

    const x = localX - contentX * boundedScale;
    const y = localY - contentY * boundedScale;

    setSurfaceView(surface, boundedScale, x, y, animate);
}

function setSurfaceView(surface, scale, x, y, animate = false) {
    if (animate) {
        animateSurfaceView(surface, scale, x, y);
        return;
    }

    stopSurfaceAnimation(surface);
    surface.scale = scale;
    surface.x = x;
    surface.y = y;
    clampSurfacePosition(surface);
    updateSurfaceTransform(surface);
}

function animateSurfaceView(surface, targetScale, targetX, targetY) {
    stopSurfaceAnimation(surface);

    const startScale = surface.scale;
    const startX = surface.x;
    const startY = surface.y;
    const startedAt = performance.now();

    surface.viewAnimationFrame = window.requestAnimationFrame(function animateFrame(now) {
        const progress = clamp((now - startedAt) / VIEW_ANIMATION_DURATION, 0, 1);
        const easedProgress = 1 - Math.pow(1 - progress, 3);

        surface.scale = startScale + (targetScale - startScale) * easedProgress;
        surface.x = startX + (targetX - startX) * easedProgress;
        surface.y = startY + (targetY - startY) * easedProgress;

        clampSurfacePosition(surface);
        updateSurfaceTransform(surface);

        if (progress < 1) {
            surface.viewAnimationFrame = window.requestAnimationFrame(animateFrame);
            return;
        }

        surface.viewAnimationFrame = 0;
    });
}

function stopSurfaceAnimation(surface) {
    if (!surface.viewAnimationFrame) {
        return;
    }

    window.cancelAnimationFrame(surface.viewAnimationFrame);
    surface.viewAnimationFrame = 0;
}

function clampSurfacePosition(surface) {
    const viewportWidth = surface.viewport.clientWidth;
    const viewportHeight = surface.viewport.clientHeight;
    const scaledWidth = surface.contentWidth * surface.scale;
    const scaledHeight = surface.contentHeight * surface.scale;

    if (surface.isSlideshow) {
        surface.x = clamp(surface.x, viewportWidth - scaledWidth, 0);
        surface.y = 0;
        return;
    }

    if (scaledWidth <= viewportWidth - SURFACE_PADDING) {
        surface.x = Math.round((viewportWidth - scaledWidth) / 2);
    } else {
        const minX = viewportWidth - scaledWidth - SURFACE_PADDING;
        const maxX = SURFACE_PADDING;
        surface.x = clamp(surface.x, minX, maxX);
    }

    if (scaledHeight <= viewportHeight - SURFACE_PADDING) {
        surface.y = Math.round((viewportHeight - scaledHeight) / 2);
    } else {
        const minY = viewportHeight - scaledHeight - SURFACE_PADDING;
        const maxY = SURFACE_PADDING;
        surface.y = clamp(surface.y, minY, maxY);
    }
}

function updateSurfaceTransform(surface) {
    if (surface.renderFrame) {
        return;
    }

    surface.renderFrame = window.requestAnimationFrame(() => {
        surface.renderFrame = 0;
        surface.canvas.style.transform = `translate3d(${surface.x}px, ${surface.y}px, 0) scale(${surface.scale})`;

        if (surface.zoomLabel) {
            surface.zoomLabel.textContent = `${Math.round(surface.scale * 100)}%`;
        }
    });
}

function beginSurfaceDrag(surface, pointerId, clientX, clientY) {
    stopSurfaceAnimation(surface);
    surface.pointerId = pointerId;
    surface.startPointerX = clientX;
    surface.startPointerY = clientY;
    surface.startX = surface.x;
    surface.startY = surface.y;
    surface.isDragging = false;
    surface.isPinching = false;
    surface.viewport.classList.remove('is-dragging');
}

function beginSurfacePinch(surface) {
    const pointers = getTrackedPointers(surface);

    if (pointers.length < 2) {
        return;
    }

    stopSurfaceAnimation(surface);
    const rect = surface.viewport.getBoundingClientRect();
    const midpoint = getPointerMidpoint(pointers[0], pointers[1]);
    const localX = midpoint.x - rect.left;
    const localY = midpoint.y - rect.top;

    surface.pointerId = null;
    surface.isDragging = false;
    surface.isPinching = true;
    surface.clickSuppressed = true;
    surface.viewport.classList.add('is-dragging');
    ensurePointerCapture(surface, pointers[0].id);
    ensurePointerCapture(surface, pointers[1].id);
    surface.pinchStartDistance = Math.max(getPointerDistance(pointers[0], pointers[1]), 1);
    surface.pinchStartScale = surface.scale;
    surface.pinchAnchorX = (localX - surface.x) / surface.scale;
    surface.pinchAnchorY = (localY - surface.y) / surface.scale;
}

function updateSurfacePinch(surface) {
    const pointers = getTrackedPointers(surface);

    if (pointers.length < 2) {
        return;
    }

    const rect = surface.viewport.getBoundingClientRect();
    const midpoint = getPointerMidpoint(pointers[0], pointers[1]);
    const localX = midpoint.x - rect.left;
    const localY = midpoint.y - rect.top;
    const distance = Math.max(getPointerDistance(pointers[0], pointers[1]), 1);
    const nextScale = clamp(
        surface.pinchStartScale * Math.pow(distance / surface.pinchStartDistance, PINCH_ZOOM_EXPONENT),
        MIN_SCALE,
        MAX_SCALE
    );

    if (shouldEnterSlideshow(surface, nextScale)) {
        enterSlideshowMode(surface, surface.pinchAnchorX, surface.pinchAnchorY);
        return;
    }

    surface.scale = nextScale;
    surface.x = localX - surface.pinchAnchorX * nextScale;
    surface.y = localY - surface.pinchAnchorY * nextScale;

    clampSurfacePosition(surface);
    updateSurfaceTransform(surface);
}

function getTrackedPointers(surface) {
    return Array.from(surface.activePointers.values()).slice(0, 2);
}

function getPointerDistance(firstPointer, secondPointer) {
    return Math.hypot(secondPointer.x - firstPointer.x, secondPointer.y - firstPointer.y);
}

function getPointerMidpoint(firstPointer, secondPointer) {
    return {
        x: (firstPointer.x + secondPointer.x) / 2,
        y: (firstPointer.y + secondPointer.y) / 2
    };
}

function ensurePointerCapture(surface, pointerId) {
    if (!surface.viewport.hasPointerCapture(pointerId)) {
        surface.viewport.setPointerCapture(pointerId);
    }
}

function releaseSurfacePointer(surface, pointerId) {
    if (surface.viewport.hasPointerCapture(pointerId)) {
        surface.viewport.releasePointerCapture(pointerId);
    }

    surface.activePointers.delete(pointerId);

    if (surface.activePointers.size >= 2) {
        beginSurfacePinch(surface);
        return;
    }

    if (surface.activePointers.size === 1) {
        const [remainingPointer] = getTrackedPointers(surface);
        beginSurfaceDrag(surface, remainingPointer.id, remainingPointer.x, remainingPointer.y);
        return;
    }

    surface.viewport.classList.remove('is-dragging');
    surface.pointerId = null;
    surface.isDragging = false;
    surface.isPinching = false;
    window.setTimeout(() => {
        surface.clickSuppressed = false;
    }, 0);
}

function shouldEnterSlideshow(surface, scale) {
    return surface.name === 'modal' && !surface.isSlideshow && state.modalCards.length > 0 && scale >= SLIDESHOW_TRIGGER_SCALE;
}

function enterSlideshowMode(surface, focusContentX, focusContentY) {
    const activeIndex = getClosestCardIndex(state.modalCards, focusContentX, focusContentY);

    surface.isSlideshow = true;
    surface.isSlideshowSettled = false;
    layoutSlideshow(surface, state.modalCards, activeIndex);
    scheduleSlideshowSettle(surface);
}

function exitSlideshowMode(surface, animate = false) {
    const album = state.activeAlbum;
    const activeIndex = surface.slideshowIndex;

    if (!album || !surface.isSlideshow) {
        return;
    }

    clearSlideshowSettle(surface);
    renderModalGrid(album, false);
    surface.slideshowIndex = activeIndex;

    if (animate) {
        const focusedCard = state.modalCards[activeIndex] || state.modalCards[0];

        if (focusedCard) {
            focusCardInGrid(surface, focusedCard, SLIDESHOW_EXIT_SCALE);
        } else {
            resetSurface(surface, true);
        }
    } else {
        resetSurface(surface);
    }
}

function focusCardInGrid(surface, card, scale) {
    const rect = surface.viewport.getBoundingClientRect();
    const cardCenterX = Number(card.style.left.replace('px', '')) + Number(card.style.width.replace('px', '')) / 2;
    const cardCenterY = Number(card.style.top.replace('px', '')) + Number(card.style.height.replace('px', '')) / 2;
    const viewportCenterX = rect.width / 2;
    const viewportCenterY = rect.height / 2;
    const nextScale = clamp(scale, MIN_SCALE, MAX_SCALE);
    const x = viewportCenterX - cardCenterX * nextScale;
    const y = viewportCenterY - cardCenterY * nextScale;

    setSurfaceView(surface, nextScale, x, y, true);
}

function navigateSlideshow(surface, direction, animate = false) {
    if (!surface.isSlideshow || !state.modalCards.length) {
        return;
    }

    const nextIndex = clamp(surface.slideshowIndex + direction, 0, state.modalCards.length - 1);

    if (nextIndex === surface.slideshowIndex) {
        return;
    }

    surface.slideshowIndex = nextIndex;
    syncSlideshowState(surface, document.getElementById('modal'));
    setSurfaceView(surface, 1, -nextIndex * surface.viewport.clientWidth, 0, animate);
}

function syncSlideshowState(surface, modal) {
    if (modal) {
        modal.classList.toggle('is-slideshow', surface.isSlideshow);
        modal.classList.toggle('is-slideshow-settled', surface.isSlideshow && surface.isSlideshowSettled);
    }

    if (surface.slideCounter) {
        const total = state.modalCards.length || 1;
        const current = Math.min(surface.slideshowIndex + 1, total);
        surface.slideCounter.textContent = `${current} / ${total}`;
    }
}

function scheduleSlideshowSettle(surface) {
    clearSlideshowSettle(surface);
    surface.slideshowSettleTimer = window.setTimeout(() => {
        surface.isSlideshowSettled = true;
        syncSlideshowState(surface, document.getElementById('modal'));
        surface.slideshowSettleTimer = 0;
    }, SLIDESHOW_SETTLE_DURATION);
}

function clearSlideshowSettle(surface) {
    if (!surface.slideshowSettleTimer) {
        return;
    }

    window.clearTimeout(surface.slideshowSettleTimer);
    surface.slideshowSettleTimer = 0;
}

function getClosestCardIndex(cards, focusX, focusY) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    cards.forEach((card, index) => {
        const left = Number(card.style.left.replace('px', ''));
        const top = Number(card.style.top.replace('px', ''));
        const width = Number(card.style.width.replace('px', ''));
        const height = Number(card.style.height.replace('px', ''));

        if (focusX >= left && focusX <= left + width && focusY >= top && focusY <= top + height) {
            bestIndex = index;
            bestDistance = -1;
            return;
        }

        if (bestDistance === -1) {
            return;
        }

        const centerX = left + width / 2;
        const centerY = top + height / 2;
        const distance = Math.hypot(centerX - focusX, centerY - focusY);

        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    });

    return bestIndex;
}

function isPrimaryPointer(event) {
    return event.button === 0 || event.pointerType === 'touch';
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function getNormalizedWheelDelta(event) {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        return event.deltaY * 16;
    }

    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        return event.deltaY * window.innerHeight;
    }

    return event.deltaY;
}

function getAccentColor(seed) {
    const hue = hashString(seed) % 360;
    return `hsl(${hue} 94% 64%)`;
}

function hashString(value) {
    let hash = 0;

    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }

    return hash;
}

function getStoredBoolean(key) {
    try {
        return window.localStorage.getItem(key) === 'true';
    } catch (error) {
        return false;
    }
}

function setStoredBoolean(key, value) {
    try {
        window.localStorage.setItem(key, String(value));
    } catch (error) {
        return;
    }
}

function debounce(func, wait) {
    let timeoutId;

    return function debounced(...args) {
        clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
            func.apply(this, args);
        }, wait);
    };
}

window.addEventListener('DOMContentLoaded', init);
