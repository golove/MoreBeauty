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
const GRID_PINCH_ZOOM_EXPONENT = 1.9;
const VIEWER_PINCH_ZOOM_EXPONENT = 2.5;
const VIEWER_MAX_SCALE = 4.5;
const SLIDESHOW_TRIGGER_SCALE = MAX_SCALE * 0.985;
const SLIDESHOW_EXIT_SCALE = 2.2;
const VIEWER_DOUBLE_TAP_SCALE = 2.6;
const VIEWER_NAVIGATION_THRESHOLD = 64;
const VIEWER_FRAME_MARGIN = 36;
const VIEWER_EDGE_RESISTANCE = 0.32;
const VIEWER_SWIPE_SETTLE_RATIO = 0.18;
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
        slideshowSettleTimer: 0,
        viewerRoot: null,
        viewerSlots: [],
        viewerCurrentSlot: null,
        viewerNavOffset: 0,
        viewerNavAnimationFrame: 0,
        viewerEntryFrame: 0,
        viewerBaseX: 0,
        viewerBaseY: 0,
        viewerBaseWidth: 0,
        viewerBaseHeight: 0,
        viewerFrameX: 0,
        viewerFrameY: 0,
        viewerFrameWidth: 0,
        viewerFrameHeight: 0,
        viewerSourceRect: null
    };

    bindSurfaceEvents(surface);
    updateSurfaceTransform(surface);

    return surface;
}

function bindGlobalEvents(modal, modalClose, appTip, appTipClose) {
    const debouncedResize = debounce(() => {
        relayoutSurface(state.surfaces.app, state.albumCards, getAlbumHeight);

        if (state.activeAlbum) {
            if (state.surfaces.modal.isSlideshow) {
                layoutViewer(state.surfaces.modal, { preserveView: true });
                updateSurfaceTransform(state.surfaces.modal);
            } else {
                relayoutSurface(state.surfaces.modal, state.modalCards, getImageHeight, MODAL_TOP_OFFSET);
            }
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
                zoomSurfaceByStep(surface, ZOOM_STEP, true);
            } else if (button.dataset.action === 'zoom-out') {
                if (surface.isSlideshow) {
                    if (surface.scale > 1.02) {
                        zoomSurfaceByStep(surface, 1 / ZOOM_STEP, true);
                    } else {
                        exitSlideshowMode(surface, true);
                    }
                    return;
                }
                zoomSurfaceByStep(surface, 1 / ZOOM_STEP, true);
            } else if (button.dataset.action === 'fit') {
                if (surface.isSlideshow) {
                    resetViewer(surface, true);
                    return;
                }
                fitSurface(surface, true);
            } else if (button.dataset.action === 'reset') {
                if (surface.isSlideshow) {
                    resetViewer(surface, true);
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
        layoutViewer(surface, { preserveView: true });
        updateSurfaceTransform(surface);
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
        if (!surface.isSlideshow) {
            return;
        }

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
        if (!surface.isSlideshow) {
            return;
        }

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

            if (surface.scale > 1.02) {
                surface.x = surface.startX + deltaX;
                surface.y = surface.startY + deltaY;
                clampSurfacePosition(surface);
                updateSurfaceTransform(surface);
                return;
            }

            surface.viewerNavOffset = getViewerDragOffset(surface, deltaX);
            surface.x = 0;
            surface.y = 0;
            updateSurfaceTransform(surface);

            return;
        }
    });

    surface.viewport.addEventListener('pointerup', event => {
        releaseSurfacePointer(surface, event.pointerId);
    });

    surface.viewport.addEventListener('pointercancel', event => {
        releaseSurfacePointer(surface, event.pointerId);
    });

    surface.viewport.addEventListener('wheel', event => {
        if (!surface.isSlideshow) {
            return;
        }

        event.preventDefault();
        stopSurfaceAnimation(surface);

        if (event.ctrlKey || event.metaKey) {
            const factor = Math.exp(-getNormalizedWheelDelta(event) * WHEEL_ZOOM_SENSITIVITY);
            zoomSurface(surface, surface.scale * factor, event.clientX, event.clientY);
            return;
        }

        if (surface.scale > 1.02) {
            surface.x -= event.deltaX;
            surface.y -= event.deltaY;
            clampSurfacePosition(surface);
            updateSurfaceTransform(surface);
            return;
        }

        const navigationDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

        if (Math.abs(navigationDelta) > 8) {
            navigateSlideshow(surface, navigationDelta > 0 ? 1 : -1, true);
        }
    }, { passive: false });

    surface.viewport.addEventListener('dblclick', event => {
        if (!surface.isSlideshow) {
            return;
        }

        const nextScale = surface.scale < 1.2 ? VIEWER_DOUBLE_TAP_SCALE : 1;
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
    resetViewerState(surface);
    clearSlideshowSettle(surface);
    surface.isSlideshow = false;
    surface.isSlideshowSettled = false;
    surface.slideshowIndex = 0;
    setModalTitle(album.title || 'Untitled Album');
    syncSlideshowState(surface, modal);

    state.modalCards = (album.srcs || []).map((image, index) => createImageCard(image, index));
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
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    renderModalGrid(album);
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
    clearSlideshowSettle(state.surfaces.modal);
    resetViewerState(state.surfaces.modal);
    state.surfaces.modal.isSlideshow = false;
    state.surfaces.modal.isSlideshowSettled = false;
    state.surfaces.modal.slideshowIndex = 0;
    setModalTitle('');
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

function createImageCard(image, index) {
    const card = buildCardShell();
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Open image ${index + 1}`);
    card.dataset.slideIndex = String(index);
    card.dataset.aspectRatio = String(getAspectRatio(image.aspect_ratio));
    card.style.setProperty('--card-accent', getAccentColor(image.src || 'image'));
    card.appendChild(buildImageNode(image.src, 'Album image'));

    const handleOpenSlide = () => {
        enterSlideshowAtIndex(state.surfaces.modal, index, card);
    };

    card.addEventListener('click', handleOpenSlide);
    card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleOpenSlide();
        }
    });

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
    resetViewerState(surface);
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
    if (!surface.isSlideshow) {
        stopSurfaceAnimation(surface);
        surface.scale = 1;
        surface.x = 0;
        surface.y = 0;

        if (animate) {
            surface.viewport.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
        } else {
            surface.viewport.scrollTop = 0;
            surface.viewport.scrollLeft = 0;
        }

        updateSurfaceTransform(surface);
        return;
    }

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
    const boundedScale = clamp(nextScale, getMinScale(surface), getMaxScale(surface));
    const rect = surface.viewport.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    if (surface.isSlideshow && surface.viewerCurrentSlot) {
        const contentX = (localX - surface.viewerBaseX - surface.x) / surface.scale;
        const contentY = (localY - surface.viewerBaseY - surface.y) / surface.scale;
        const x = localX - surface.viewerBaseX - contentX * boundedScale;
        const y = localY - surface.viewerBaseY - contentY * boundedScale;

        setSurfaceView(surface, boundedScale, x, y, animate);
        return;
    }

    const contentX = (localX - surface.x) / surface.scale;
    const contentY = (localY - surface.y) / surface.scale;
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
        stopViewerNavigation(surface);
        stopViewerEntryAnimation(surface);
        return;
    }

    window.cancelAnimationFrame(surface.viewAnimationFrame);
    surface.viewAnimationFrame = 0;
    stopViewerNavigation(surface);
    stopViewerEntryAnimation(surface);
}

function clampSurfacePosition(surface) {
    if (surface.isSlideshow && surface.viewerCurrentSlot) {
        clampViewerPosition(surface);
        return;
    }

    if (!surface.isSlideshow) {
        surface.x = 0;
        surface.y = 0;
        surface.scale = 1;
        return;
    }

    const viewportWidth = surface.viewport.clientWidth;
    const viewportHeight = surface.viewport.clientHeight;
    const scaledWidth = surface.contentWidth * surface.scale;
    const scaledHeight = surface.contentHeight * surface.scale;

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

        if (surface.isSlideshow && surface.viewerRoot) {
            surface.canvas.style.transform = 'translate3d(0px, 0px, 0) scale(1)';
            updateViewerTransforms(surface);
        } else {
            surface.canvas.style.transform = `translate3d(${surface.x}px, ${surface.y}px, 0) scale(${surface.scale})`;
        }

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

    if (surface.isSlideshow && surface.viewerCurrentSlot) {
        surface.pinchAnchorX = (localX - surface.viewerBaseX - surface.x) / surface.scale;
        surface.pinchAnchorY = (localY - surface.viewerBaseY - surface.y) / surface.scale;
        return;
    }

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
        surface.pinchStartScale * Math.pow(distance / surface.pinchStartDistance, getPinchZoomExponent(surface)),
        getMinScale(surface),
        getMaxScale(surface)
    );

    if (!surface.isSlideshow && shouldEnterSlideshow(surface, nextScale)) {
        enterSlideshowMode(surface, surface.pinchAnchorX, surface.pinchAnchorY);
        return;
    }

    surface.scale = nextScale;

    if (surface.isSlideshow && surface.viewerCurrentSlot) {
        surface.x = localX - surface.viewerBaseX - surface.pinchAnchorX * nextScale;
        surface.y = localY - surface.viewerBaseY - surface.pinchAnchorY * nextScale;
    } else {
        surface.x = localX - surface.pinchAnchorX * nextScale;
        surface.y = localY - surface.pinchAnchorY * nextScale;
    }

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

    if (surface.isSlideshow && surface.scale <= 1.02) {
        settleViewerSwipe(surface);
    }

    window.setTimeout(() => {
        surface.clickSuppressed = false;
    }, 0);
}

function getPinchZoomExponent(surface) {
    return surface.isSlideshow ? VIEWER_PINCH_ZOOM_EXPONENT : GRID_PINCH_ZOOM_EXPONENT;
}

function getMinScale(surface) {
    return surface.isSlideshow ? 1 : MIN_SCALE;
}

function getMaxScale(surface) {
    return surface.isSlideshow ? VIEWER_MAX_SCALE : MAX_SCALE;
}

function shouldEnterSlideshow(surface, scale) {
    return false;
}

function enterSlideshowMode(surface, focusContentX, focusContentY) {
    const activeIndex = getClosestCardIndex(state.modalCards, focusContentX, focusContentY);
    const sourceCard = state.modalCards[activeIndex] || null;

    enterSlideshowAtIndex(surface, activeIndex, sourceCard);
}

function enterSlideshowAtIndex(surface, activeIndex, sourceCard = null) {
    if (!surface || !state.modalCards.length) {
        return;
    }

    surface.isSlideshow = true;
    surface.isSlideshowSettled = false;
    surface.slideshowIndex = clamp(activeIndex, 0, Math.max(state.modalCards.length - 1, 0));
    renderViewer(surface, surface.slideshowIndex, {
        entryRect: sourceCard ? getSurfaceCardRect(surface, sourceCard) : null
    });
    scheduleSlideshowSettle(surface);
}

function exitSlideshowMode(surface, animate = false) {
    const album = state.activeAlbum;
    const activeIndex = surface.slideshowIndex;

    if (!album || !surface.isSlideshow) {
        return;
    }

    clearSlideshowSettle(surface);
    resetViewerState(surface);
    renderModalGrid(album, false);
    surface.slideshowIndex = activeIndex;

    const focusedCard = state.modalCards[activeIndex] || state.modalCards[0];

    if (focusedCard) {
        focusCardInGrid(surface, focusedCard, animate);
    } else {
        resetSurface(surface);
    }
}

function focusCardInGrid(surface, card, animate = false) {
    card.scrollIntoView({
        behavior: animate ? 'smooth' : 'auto',
        block: 'center',
        inline: 'nearest'
    });
}

function navigateSlideshow(surface, direction, animate = false) {
    if (!surface.isSlideshow || !state.modalCards.length) {
        return;
    }

    const nextIndex = clamp(surface.slideshowIndex + direction, 0, state.modalCards.length - 1);

    if (nextIndex === surface.slideshowIndex) {
        return;
    }

    if (animate && surface.scale <= 1.02) {
        animateViewerNavigation(surface, direction);
        return;
    }

    stopViewerNavigation(surface);
    surface.slideshowIndex = nextIndex;
    renderViewer(surface, nextIndex);
    scheduleSlideshowSettle(surface);
}

function renderViewer(surface, index, options = {}) {
    const image = getModalImage(index);
    const { entryRect = null, preserveView = false } = options;

    if (!surface || !image) {
        return;
    }

    ensureViewerRoot(surface);

    if (surface.canvas.firstChild !== surface.viewerRoot) {
        clearCanvas(surface.canvas);
        surface.canvas.appendChild(surface.viewerRoot);
    }

    surface.slideshowIndex = index;
    updateViewerSlots(surface, index);
    layoutViewer(surface, { preserveView });

    if (entryRect) {
        animateViewerEntry(surface, entryRect);
    } else {
        updateSurfaceTransform(surface);
    }

    preloadAdjacentImages(state.activeAlbum, index);
    syncSlideshowState(surface, document.getElementById('modal'));
}

function ensureViewerRoot(surface) {
    if (surface.viewerRoot && surface.viewerSlots.length === 3) {
        return;
    }

    const root = document.createElement('div');
    root.className = 'viewer-root';
    const slots = [];

    [-1, 0, 1].forEach(offset => {
        const card = buildCardShell();
        card.classList.add('viewer-slot');
        card.dataset.viewerOffset = String(offset);
        card.appendChild(buildImageNode('', 'Album image'));
        root.appendChild(card);
        slots.push(card);
    });

    surface.viewerRoot = root;
    surface.viewerSlots = slots;
}

function updateViewerSlots(surface, index) {
    surface.viewerCurrentSlot = null;

    surface.viewerSlots.forEach(slot => {
        const relativeOffset = Number(slot.dataset.viewerOffset || 0);
        const imageIndex = index + relativeOffset;
        const image = getModalImage(imageIndex);
        const img = slot.querySelector('img');

        slot.classList.toggle('is-current', relativeOffset === 0);
        slot.classList.toggle('is-adjacent', relativeOffset !== 0);
        slot.classList.toggle('is-hidden', !image);
        slot.dataset.viewerIndex = image ? String(imageIndex) : '';

        if (!img) {
            return;
        }

        if (!image) {
            img.removeAttribute('src');
            img.alt = '';
            return;
        }

        if (img.src !== image.src) {
            img.src = image.src || '';
        }

        img.alt = `Album image ${imageIndex + 1}`;
        img.loading = relativeOffset === 0 ? 'eager' : 'lazy';
        slot.dataset.aspectRatio = String(getAspectRatio(image.aspect_ratio));
        slot.style.setProperty('--card-accent', getAccentColor(image.src || `image-${imageIndex}`));

        if (relativeOffset === 0) {
            surface.viewerCurrentSlot = slot;
        }
    });
}

function layoutViewer(surface, options = {}) {
    const { preserveView = false } = options;

    if (!surface.viewerRoot || !surface.viewerSlots.length) {
        return;
    }

    const viewportWidth = surface.viewport.clientWidth;
    const viewportHeight = surface.viewport.clientHeight;
    const frameX = VIEWER_FRAME_MARGIN;
    const frameY = MODAL_TOP_OFFSET + 32;
    const frameWidth = Math.max(220, viewportWidth - VIEWER_FRAME_MARGIN * 2);
    const frameHeight = Math.max(160, viewportHeight - frameY - VIEWER_FRAME_MARGIN);
    surface.viewerFrameX = frameX;
    surface.viewerFrameY = frameY;
    surface.viewerFrameWidth = frameWidth;
    surface.viewerFrameHeight = frameHeight;
    surface.contentWidth = viewportWidth;
    surface.contentHeight = viewportHeight;

    surface.canvas.style.width = `${viewportWidth}px`;
    surface.canvas.style.height = `${viewportHeight}px`;

    surface.viewerSlots.forEach(slot => {
        const imageIndex = Number(slot.dataset.viewerIndex);
        const relativeOffset = Number(slot.dataset.viewerOffset || 0);
        const image = Number.isNaN(imageIndex) ? null : getModalImage(imageIndex);
        const slotMetrics = getViewerSlotMetrics(viewportWidth, frameX, frameY, frameWidth, frameHeight, image, relativeOffset);

        slot.style.left = `${slotMetrics.left}px`;
        slot.style.top = `${slotMetrics.top}px`;
        slot.style.width = `${slotMetrics.width}px`;
        slot.style.height = `${slotMetrics.height}px`;

        if (relativeOffset === 0) {
            surface.viewerBaseX = slotMetrics.left;
            surface.viewerBaseY = slotMetrics.top;
            surface.viewerBaseWidth = slotMetrics.width;
            surface.viewerBaseHeight = slotMetrics.height;
            surface.viewerCurrentSlot = slot;
        }
    });

    if (!preserveView) {
        surface.scale = 1;
        surface.x = 0;
        surface.y = 0;
        surface.viewerNavOffset = 0;
    } else {
        clampSurfacePosition(surface);
    }
}

function getViewerSlotMetrics(viewportWidth, frameX, frameY, frameWidth, frameHeight, image, relativeOffset) {
    if (!image) {
        return {
            left: Math.round(frameX + relativeOffset * viewportWidth),
            top: Math.round(frameY + frameHeight / 2),
            width: 0,
            height: 0
        };
    }

    const aspectRatio = getAspectRatio(image.aspect_ratio);
    const widthByHeight = frameHeight * aspectRatio;
    const heightByWidth = frameWidth / aspectRatio;
    const width = Math.min(frameWidth, widthByHeight);
    const height = Math.min(frameHeight, heightByWidth);
    const left = Math.round(frameX + (frameWidth - width) / 2 + relativeOffset * viewportWidth);
    const top = Math.round(frameY + (frameHeight - height) / 2);

    return { left, top, width, height };
}

function resetViewer(surface, animate = false) {
    stopViewerNavigation(surface);
    surface.viewerNavOffset = 0;
    setSurfaceView(surface, 1, 0, 0, animate);
}

function clampViewerPosition(surface) {
    const scaledWidth = surface.viewerBaseWidth * surface.scale;
    const scaledHeight = surface.viewerBaseHeight * surface.scale;
    const frameLeft = surface.viewerFrameX;
    const frameTop = surface.viewerFrameY;
    const frameWidth = surface.viewerFrameWidth;
    const frameHeight = surface.viewerFrameHeight;

    let nextLeft = surface.viewerBaseX + surface.x;
    let nextTop = surface.viewerBaseY + surface.y;

    if (scaledWidth <= frameWidth) {
        nextLeft = frameLeft + (frameWidth - scaledWidth) / 2;
    } else {
        nextLeft = clamp(nextLeft, frameLeft + frameWidth - scaledWidth, frameLeft);
    }

    if (scaledHeight <= frameHeight) {
        nextTop = frameTop + (frameHeight - scaledHeight) / 2;
    } else {
        nextTop = clamp(nextTop, frameTop + frameHeight - scaledHeight, frameTop);
    }

    surface.x = Math.round(nextLeft - surface.viewerBaseX);
    surface.y = Math.round(nextTop - surface.viewerBaseY);
}

function updateViewerTransforms(surface) {
    surface.viewerSlots.forEach(slot => {
        if (slot.classList.contains('is-hidden')) {
            slot.style.transform = 'translate3d(0px, 0px, 0) scale(1)';
            return;
        }

        const relativeOffset = Number(slot.dataset.viewerOffset || 0);
        const translateX = surface.viewerNavOffset + (relativeOffset === 0 ? surface.x : 0);
        const translateY = relativeOffset === 0 ? surface.y : 0;
        const scale = relativeOffset === 0 ? surface.scale : 1;

        slot.style.transform = `translate3d(${Math.round(translateX)}px, ${Math.round(translateY)}px, 0) scale(${scale})`;
    });
}

function getViewerDragOffset(surface, deltaX) {
    const direction = deltaX < 0 ? 1 : -1;
    const nextIndex = surface.slideshowIndex + direction;

    if (nextIndex < 0 || nextIndex >= state.modalCards.length) {
        return Math.round(deltaX * VIEWER_EDGE_RESISTANCE);
    }

    return Math.round(deltaX);
}

function settleViewerSwipe(surface) {
    if (!surface.isSlideshow || surface.scale > 1.02 || Math.abs(surface.viewerNavOffset) < 1) {
        animateViewerOffset(surface, 0);
        return;
    }

    const threshold = Math.max(VIEWER_NAVIGATION_THRESHOLD, surface.viewport.clientWidth * VIEWER_SWIPE_SETTLE_RATIO);
    const direction = surface.viewerNavOffset <= -threshold
        ? 1
        : surface.viewerNavOffset >= threshold
            ? -1
            : 0;

    if (!direction) {
        animateViewerOffset(surface, 0);
        return;
    }

    navigateSlideshow(surface, direction, true);
}

function animateViewerNavigation(surface, direction) {
    const nextIndex = clamp(surface.slideshowIndex + direction, 0, state.modalCards.length - 1);

    if (nextIndex === surface.slideshowIndex) {
        animateViewerOffset(surface, 0);
        return;
    }

    const targetOffset = -direction * surface.viewport.clientWidth;

    animateViewerOffset(surface, targetOffset, () => {
        surface.slideshowIndex = nextIndex;
        surface.scale = 1;
        surface.x = 0;
        surface.y = 0;
        surface.viewerNavOffset = 0;
        renderViewer(surface, nextIndex);
        scheduleSlideshowSettle(surface);
    });
}

function animateViewerOffset(surface, targetOffset, onComplete = null) {
    stopViewerNavigation(surface);

    const startOffset = surface.viewerNavOffset;
    const startedAt = performance.now();

    surface.viewerNavAnimationFrame = window.requestAnimationFrame(function animateFrame(now) {
        const progress = clamp((now - startedAt) / VIEW_ANIMATION_DURATION, 0, 1);
        const easedProgress = 1 - Math.pow(1 - progress, 3);

        surface.viewerNavOffset = startOffset + (targetOffset - startOffset) * easedProgress;
        updateSurfaceTransform(surface);

        if (progress < 1) {
            surface.viewerNavAnimationFrame = window.requestAnimationFrame(animateFrame);
            return;
        }

        surface.viewerNavAnimationFrame = 0;
        surface.viewerNavOffset = targetOffset;
        updateSurfaceTransform(surface);

        if (typeof onComplete === 'function') {
            onComplete();
        }
    });
}

function stopViewerNavigation(surface) {
    if (!surface.viewerNavAnimationFrame) {
        return;
    }

    window.cancelAnimationFrame(surface.viewerNavAnimationFrame);
    surface.viewerNavAnimationFrame = 0;
}

function animateViewerEntry(surface, sourceRect) {
    if (!surface.viewerCurrentSlot || !sourceRect) {
        updateSurfaceTransform(surface);
        return;
    }

    stopViewerEntryAnimation(surface);

    const slot = surface.viewerCurrentSlot;
    const finalLeft = slot.style.left;
    const finalTop = slot.style.top;
    const finalWidth = slot.style.width;
    const finalHeight = slot.style.height;

    surface.viewerSlots.forEach(viewerSlot => {
        if (viewerSlot !== slot) {
            viewerSlot.classList.add('is-entry-hidden');
        }
    });

    slot.style.transition = 'none';
    slot.style.left = `${Math.round(sourceRect.left)}px`;
    slot.style.top = `${Math.round(sourceRect.top)}px`;
    slot.style.width = `${Math.round(sourceRect.width)}px`;
    slot.style.height = `${Math.round(sourceRect.height)}px`;
    slot.style.transform = 'translate3d(0px, 0px, 0) scale(1)';

    surface.viewerEntryFrame = window.requestAnimationFrame(() => {
        surface.viewerEntryFrame = 0;
        slot.style.transition = '';
        slot.style.left = finalLeft;
        slot.style.top = finalTop;
        slot.style.width = finalWidth;
        slot.style.height = finalHeight;
        surface.viewerSlots.forEach(viewerSlot => {
            viewerSlot.classList.remove('is-entry-hidden');
        });
        updateSurfaceTransform(surface);
    });
}

function stopViewerEntryAnimation(surface) {
    if (!surface.viewerEntryFrame) {
        return;
    }

    window.cancelAnimationFrame(surface.viewerEntryFrame);
    surface.viewerEntryFrame = 0;
}

function getSurfaceCardRect(surface, card) {
    const left = Number(card.style.left.replace('px', ''));
    const top = Number(card.style.top.replace('px', ''));
    const width = Number(card.style.width.replace('px', ''));
    const height = Number(card.style.height.replace('px', ''));

    if (!surface.isSlideshow) {
        return {
            left: left - surface.viewport.scrollLeft,
            top: top - surface.viewport.scrollTop,
            width,
            height
        };
    }

    return {
        left: surface.x + left * surface.scale,
        top: surface.y + top * surface.scale,
        width: width * surface.scale,
        height: height * surface.scale
    };
}

function resetViewerState(surface) {
    stopViewerNavigation(surface);
    stopViewerEntryAnimation(surface);
    surface.viewerRoot = null;
    surface.viewerSlots = [];
    surface.viewerCurrentSlot = null;
    surface.viewerNavOffset = 0;
    surface.viewerBaseX = 0;
    surface.viewerBaseY = 0;
    surface.viewerBaseWidth = 0;
    surface.viewerBaseHeight = 0;
    surface.viewerFrameX = 0;
    surface.viewerFrameY = 0;
    surface.viewerFrameWidth = 0;
    surface.viewerFrameHeight = 0;
    surface.x = 0;
    surface.y = 0;
    surface.scale = 1;
    surface.viewerSourceRect = null;
}

function getModalImage(index) {
    if (!state.activeAlbum || !Array.isArray(state.activeAlbum.srcs)) {
        return null;
    }

    return state.activeAlbum.srcs[index] || null;
}

function getActiveModalImage() {
    return getModalImage(state.surfaces.modal.slideshowIndex);
}

function preloadAdjacentImages(album, index) {
    if (!album || !Array.isArray(album.srcs)) {
        return;
    }

    [-2, -1, 1, 2].forEach(offset => {
        const image = album.srcs[index + offset];

        if (!image || !image.src) {
            return;
        }

        const preload = new Image();
        preload.decoding = 'async';
        preload.referrerPolicy = 'no-referrer';
        preload.src = image.src;
    });
}

function setModalTitle(title) {
    const modalTitle = document.getElementById('modal-title');

    if (!modalTitle) {
        return;
    }

    modalTitle.textContent = title;
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
